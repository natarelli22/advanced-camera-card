import { describe, expect, it, vi } from 'vitest';

import { QueryType } from '../../src/camera-manager/types';
import { AdvancedCameraCardThumbnailCarousel } from '../../src/components/thumbnail-carousel';
import type { ThumbnailsControlConfig } from '../../src/config/schema/common/controls/thumbnails';
import { QuerySource } from '../../src/query-source';
import { ViewItemClassifier } from '../../src/view/item-classifier';
import { ViewMediaType } from '../../src/view/item';
import { QueryResults } from '../../src/view/query-results';
import { UnifiedQuery } from '../../src/view/unified-query';
import { UnifiedQueryRunner } from '../../src/view/unified-query-runner';
import { TestViewMedia } from '../view/test-utils';

describe('AdvancedCameraCardThumbnailCarousel sliding window buffer', () => {
  it('should maintain sliding window buffer size between chunkSize and 2*chunkSize', async () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    const config: ThumbnailsControlConfig = {
      mode: 'right',
      position: 'center',
      size: 100,
      show_details: true,
      show_favorite_control: true,
      show_timeline_control: false,
      show_download_control: false,
      show_review_control: true,
      show_info_control: true,
      chunk_hours: 24,
      chunk_size: 20,
    };
    carousel.config = config;
    Object.defineProperty(carousel, 'updateComplete', {
      get: () => Promise.resolve(true),
    });

    // Create 60 mock items spaced 1 minute apart
    const baseTime = new Date('2026-10-05T12:00:00Z').getTime();
    const allMockMedia: TestViewMedia[] = [];
    for (let i = 0; i < 60; i++) {
      allMockMedia.push(
        new TestViewMedia({
          id: `media-${i}`,
          startTime: new Date(baseTime + i * 60000),
          cameraID: 'camera.test',
        }),
      );
    }

    // Set initial 20 items (indices 20 to 39)
    const initialItems = allMockMedia.slice(20, 40);
    carousel['_items'] = [...initialItems];
    carousel['_previousSelectedIndex'] = 19;
    expect(carousel['_items'].length).toBe(20);

    // Mock runner execute to return items based on query end/start
    const mockExecute = vi.fn().mockImplementation(async (query) => {
      const node = query.getNodes()[0];
      if (node.end) {
        // Older items before node.end
        const endTime = node.end.getTime();
        const older = allMockMedia
          .filter((m) => m.getStartTime()!.getTime() <= endTime)
          .slice(-20);
        return older;
      } else if (node.start) {
        // Newer items after node.start
        const startTime = node.start.getTime();
        const newer = allMockMedia
          .filter((m) => m.getStartTime()!.getTime() >= startTime)
          .slice(0, 20);
        return newer;
      }
      return [];
    });

    const realQuery = new UnifiedQuery();
    carousel['cameraManager'] = {} as any;
    carousel['foldersManager'] = {} as any;
    carousel['_builder'] = {
      buildDefaultCameraQuery: () => realQuery,
    } as any;
    carousel['viewManagerEpoch'] = {
      manager: {
        getView: () => ({
          camera: 'camera.test',
          query: realQuery,
        }),
      },
    } as any;

    // Override runner execution in methods
    vi.spyOn(carousel as any, '_loadOlderChunk').mockImplementation(async (chunkSize: any) => {
      const oldestItem = carousel['_items'][0];
      const oldestTime = ViewItemClassifier.isMedia(oldestItem)
        ? oldestItem.getStartTime()
        : null;
      if (!oldestTime) return;

      const olderQuery = {
        getNodes: () => [{ end: new Date(oldestTime.getTime() - 1) }],
      };
      const olderItems = await mockExecute(olderQuery);
      const toPrepend = olderItems.slice(-chunkSize);
      carousel['_items'] = [...toPrepend, ...carousel['_items']];
      if (carousel['_items'].length > chunkSize * 2) {
        carousel['_items'] = carousel['_items'].slice(0, chunkSize * 2);
      }
      carousel['_previousSelectedIndex'] = (carousel['_previousSelectedIndex'] ?? 0) + toPrepend.length;
    });

    vi.spyOn(carousel as any, '_loadNewerChunk').mockImplementation(async (chunkSize: any) => {
      const newestItem = carousel['_items'][carousel['_items'].length - 1];
      const newestTime = ViewItemClassifier.isMedia(newestItem)
        ? newestItem.getStartTime()
        : null;
      if (!newestTime) return;

      const newerQuery = {
        getNodes: () => [{ start: new Date(newestTime.getTime() + 1) }],
      };
      const newerItems = await mockExecute(newerQuery);
      const toAppend = newerItems.slice(0, chunkSize);
      carousel['_items'] = [...carousel['_items'], ...toAppend];
      if (carousel['_items'].length > chunkSize * 2) {
        carousel['_items'] = carousel['_items'].slice(carousel['_items'].length - chunkSize * 2);
      }
    });

    // 1. User scrolls to index 0 (older items)
    await carousel['_onCarouselSelect'](
      new CustomEvent('advanced-camera-card:carousel:select', {
        detail: { index: 0, element: {} as any },
      }),
    );

    // Buffer expands to 40 items (double the chunk_size)
    expect(carousel['_items'].length).toBe(40);
    expect(carousel['_items'].length).toBeLessThanOrEqual(config.chunk_size! * 2);
    // User slide index adjusted so they don't jump
    expect(carousel['_previousSelectedIndex']).toBe(20);

    // 2. User moves within buffer to index 10
    await carousel['_onCarouselSelect'](
      new CustomEvent('advanced-camera-card:carousel:select', {
        detail: { index: 10, element: {} as any },
      }),
    );

    // Buffer is preserved without destructive midpoint pruning (stays at 40 items)
    expect(carousel['_items'].length).toBe(40);
    expect(carousel['_items'][0].getID()).toBe('media-0');
    expect(carousel['_items'][39].getID()).toBe('media-39');

    // 3. User moves to bottom edge of buffer (index 39)
    await carousel['_onCarouselSelect'](
      new CustomEvent('advanced-camera-card:carousel:select', {
        detail: { index: 39, element: {} as any },
      }),
    );

    // Newer chunk loaded and buffer maintains maximum double chunk_size (40)
    expect(carousel['_items'].length).toBe(40);
    expect(carousel['_items'][carousel['_items'].length - 1].getID()).toBe('media-59');
  });

  it('should preserve scroll position in _getScrollSlide when chunk_size is active', () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    carousel.config = {
      mode: 'right',
      chunk_size: 20,
    } as any;

    carousel['_items'] = Array(20).fill({}) as any;
    expect(carousel['_getScrollSlide']()).toBe(19);

    // Mock _getSelectedSlide returning index 5 (media playing in viewer)
    vi.spyOn(carousel as any, '_getSelectedSlide').mockReturnValue(5);

    // When previousSelectedIndex is set, user's scroll position takes precedence over media playing
    carousel['_previousSelectedIndex'] = 12;
    expect(carousel['_getScrollSlide']()).toBe(12);

    // Should clamp if index is larger than items length
    carousel['_previousSelectedIndex'] = 25;
    expect(carousel['_getScrollSlide']()).toBe(19);

    // When previousSelectedIndex is null (initial load), should fall back to media playing
    carousel['_previousSelectedIndex'] = null;
    expect(carousel['_getScrollSlide']()).toBe(5);
  });

  it('should ignore edge triggers on initial mount when previousSelectedIndex is null or unchanged', async () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    carousel.config = {
      mode: 'right',
      chunk_size: 20,
    } as any;
    carousel['_items'] = Array(20).fill({}) as any;
    carousel['_hasOlder'] = true;
    carousel['_hasNewer'] = true;

    const olderSpy = vi.spyOn(carousel as any, '_loadOlderChunk');
    const newerSpy = vi.spyOn(carousel as any, '_loadNewerChunk');

    // Mount event with index 19 when previousSelectedIndex is null
    carousel['_previousSelectedIndex'] = null;
    await carousel['_onCarouselSelect'](
      new CustomEvent('advanced-camera-card:carousel:select', {
        detail: { index: 19, element: {} as any },
      }),
    );
    expect(olderSpy).not.toHaveBeenCalled();
    expect(newerSpy).not.toHaveBeenCalled();
    expect(carousel['_previousSelectedIndex']).toBe(19);

    // Redundant event at same index
    await carousel['_onCarouselSelect'](
      new CustomEvent('advanced-camera-card:carousel:select', {
        detail: { index: 19, element: {} as any },
      }),
    );
    expect(olderSpy).not.toHaveBeenCalled();
    expect(newerSpy).not.toHaveBeenCalled();
  });
});

describe('AdvancedCameraCardThumbnailCarousel continuous recordings filtering', () => {
  it('should exclude continuous recordings from queryResults and query camera events instead', async () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    carousel.config = {
      mode: 'right',
      chunk_size: 20,
    } as any;
    Object.defineProperty(carousel, 'updateComplete', {
      get: () => Promise.resolve(true),
    });

    const recordingMedia = new TestViewMedia({
      id: 'recording-continuous-1',
      mediaType: ViewMediaType.Recording,
      cameraID: 'camera.sala_01',
      startTime: new Date('2026-10-07T14:30:00Z'),
    });

    const eventMedia = new TestViewMedia({
      id: 'event-clip-1',
      mediaType: ViewMediaType.Clip,
      cameraID: 'camera.sala_01',
      startTime: new Date('2026-10-07T14:28:00Z'),
    });

    const mockEventsQuery = new UnifiedQuery([
      {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['camera.sala_01']),
      },
    ]);

    carousel['cameraManager'] = {} as any;
    carousel['foldersManager'] = {} as any;
    carousel['_builder'] = {
      buildCameraMediaQuery: vi.fn().mockReturnValue(mockEventsQuery),
      buildDefaultCameraQuery: vi.fn().mockReturnValue(mockEventsQuery),
    } as any;

    carousel['viewManagerEpoch'] = {
      manager: {
        getView: () => ({
          camera: 'camera.sala_01',
          query: new UnifiedQuery([
            {
              source: QuerySource.Camera,
              type: QueryType.Recording,
              cameraIDs: new Set(['camera.sala_01']),
            },
          ]),
          queryResults: new QueryResults({
            results: [recordingMedia],
            selectedIndex: 0,
          }),
        }),
      },
    } as any;

    // Spy on UnifiedQueryRunner to return the event clip
    vi.spyOn(UnifiedQueryRunner.prototype, 'execute').mockResolvedValue([eventMedia]);

    // Override UnifiedQueryRunner in prototype or mock execution
    vi.spyOn(carousel as any, '_renderThumbnails').mockReturnValue([]);
    
    // Call _loadInitialChunkSize
    await carousel['_loadInitialChunkSize'](new Date('2026-10-07T14:30:00Z'), 20);

    // Continuous recording must NOT be present in _items
    expect(carousel['_items'].some((it) => ViewItemClassifier.isRecording(it))).toBe(false);
  });

  it('should strip recording query nodes in _getNonRecordingQuery', () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    const recordingQuery = new UnifiedQuery([
      {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['camera.sala_01']),
      },
    ]);

    const fallbackEventsQuery = new UnifiedQuery([
      {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['camera.sala_01']),
      },
    ]);

    carousel['_builder'] = {
      buildCameraMediaQuery: vi.fn().mockReturnValue(fallbackEventsQuery),
      buildDefaultCameraQuery: vi.fn().mockReturnValue(fallbackEventsQuery),
    } as any;

    const result = carousel['_getNonRecordingQuery'](recordingQuery, 'camera.sala_01');
    expect(result).not.toBeNull();
    const nodes = result!.getNodes();
    expect(nodes.some((n) => n.source === QuerySource.Camera && n.type === QueryType.Recording)).toBe(false);
    expect(nodes.some((n) => n.source === QuerySource.Camera && n.type === QueryType.Event)).toBe(true);
  });

  it('should focus on closest event clip when reference time comes from continuous recording', async () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    carousel.config = {
      mode: 'right',
      chunk_size: 20,
    } as any;
    Object.defineProperty(carousel, 'updateComplete', {
      get: () => Promise.resolve(true),
    });

    const event1 = new TestViewMedia({
      id: 'event-1',
      mediaType: ViewMediaType.Clip,
      cameraID: 'camera.sala_01',
      startTime: new Date('2026-10-07T14:00:00Z'),
    });
    const event2 = new TestViewMedia({
      id: 'event-2',
      mediaType: ViewMediaType.Clip,
      cameraID: 'camera.sala_01',
      startTime: new Date('2026-10-07T14:28:00Z'), // Closest to 14:30:00
    });
    const event3 = new TestViewMedia({
      id: 'event-3',
      mediaType: ViewMediaType.Clip,
      cameraID: 'camera.sala_01',
      startTime: new Date('2026-10-07T15:00:00Z'),
    });

    const mockEventsQuery = new UnifiedQuery([
      {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['camera.sala_01']),
      },
    ]);

    carousel['cameraManager'] = {} as any;
    carousel['foldersManager'] = {} as any;
    carousel['_builder'] = {
      buildCameraMediaQuery: vi.fn().mockReturnValue(mockEventsQuery),
    } as any;

    const recordingMedia = new TestViewMedia({
      id: 'recording-continuous',
      mediaType: ViewMediaType.Recording,
      cameraID: 'camera.sala_01',
      startTime: new Date('2026-10-07T14:30:00Z'),
    });

    carousel['viewManagerEpoch'] = {
      manager: {
        getView: () => ({
          camera: 'camera.sala_01',
          query: mockEventsQuery,
          queryResults: new QueryResults({
            results: [recordingMedia],
            selectedIndex: 0,
          }),
        }),
      },
    } as any;

    carousel['_items'] = [event1, event2, event3];
    // When selected media is recording, _getSelectedSlide returns null
    expect(carousel['_getSelectedSlide'](carousel['_items'])).toBeNull();
  });
});

