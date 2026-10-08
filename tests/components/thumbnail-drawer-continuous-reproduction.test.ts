import { describe, expect, it, vi } from 'vitest';
import { ViewMediaType } from '../../src/view/item';
import { ViewItemClassifier } from '../../src/view/item-classifier';
import { QueryResults } from '../../src/view/query-results';
import { TestViewMedia } from '../view/test-utils';
import { AdvancedCameraCardThumbnailCarousel } from '../../src/components/thumbnail-carousel';
import type { ThumbnailsControlConfig } from '../../src/config/schema/common/controls/thumbnails';
import { UnifiedQuery } from '../../src/view/unified-query';
import { QuerySource } from '../../src/query-source';
import { QueryType } from '../../src/camera-manager/types';

describe('Thumbnail Carousel Continuous Recordings Reproduction', () => {
  it('checks why continuous recordings appear in drawer when switching from Sala 02 to Sala 01', async () => {
    const carousel = new AdvancedCameraCardThumbnailCarousel();
    const config = {
      mode: 'right',
      position: 'selected',
      size: 100,
      show_details: true,
      chunk_size: 20,
    } as unknown as ThumbnailsControlConfig;
    carousel.config = config;
    Object.defineProperty(carousel, 'updateComplete', {
      get: () => Promise.resolve(true),
    });

    // Create 5 continuous recordings for Sala 01
    const sala01Recordings: TestViewMedia[] = [];
    const timestamps = [
      '2026-10-07T19:18:12Z',
      '2026-10-07T19:47:40Z',
      '2026-10-07T20:16:52Z',
      '2026-10-07T20:46:02Z',
      '2026-10-07T21:15:55Z',
    ];
    for (let i = 0; i < timestamps.length; i++) {
      sala01Recordings.push(
        new TestViewMedia({
          id: `rec-${i}`,
          startTime: new Date(timestamps[i]),
          cameraID: 'camera.sala_01',
          mediaType: ViewMediaType.Recording,
        }),
      );
    }

    // Also create 1 event for Sala 02
    const sala02Event = new TestViewMedia({
      id: 'event-sala02',
      startTime: new Date('2026-10-07T21:20:25Z'),
      cameraID: 'camera.sala_02',
      mediaType: ViewMediaType.Clip,
    });

    // Now QueryResults has both
    const queryResults = new QueryResults({
      results: [sala02Event, ...sala01Recordings],
      selectedIndex: 0, // currently Sala 02 is main selected
    });

    // Sala 01 selected result is rec-4 (21:15:55)
    queryResults.selectResultIfFound((m) => m.getID() === 'rec-4', {
      cameraID: 'camera.sala_01',
    });

    expect(ViewItemClassifier.isRecording(sala01Recordings[0])).toBe(true);
    expect(ViewItemClassifier.isRecording(sala02Event)).toBe(false);

    // Mock cameraManager and runner
    const mockEventsQuery = new UnifiedQuery([
      {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['camera.sala_01']),
      },
    ]);

    carousel['cameraManager'] = {
      getStore: () => ({
        getCameraConfig: () => ({ media: { type: 'events' } }),
        getCameraIDsWithCapability: () => new Set(['camera.sala_01']),
        getAllDependentCameras: () => new Set(['camera.sala_01']),
      }),
      getCameraCapabilities: () => new Set(['clips', 'recordings']),
    } as any;
    carousel['foldersManager'] = {} as any;
    carousel['_builder'] = {
      buildCameraMediaQuery: vi.fn().mockReturnValue(mockEventsQuery),
      buildDefaultCameraQuery: vi.fn().mockReturnValue(mockEventsQuery),
    } as any;

    // View is in grid mode, but user clicks Sala 01 window
    // promoteCameraSelectionToMainSelection('camera.sala_01')
    const viewQueryResults = queryResults.clone().promoteCameraSelectionToMainSelection('camera.sala_01');

    carousel['viewManagerEpoch'] = {
      manager: {
        getView: () => ({
          camera: 'camera.sala_01',
          displayMode: 'grid',
          isGrid: () => true,
          view: 'media',
          query: null,
          queryResults: viewQueryResults,
          context: {
            mediaViewer: {
              seek: new Date('2026-10-07T21:20:25Z'),
            },
          },
        }),
      },
    } as any;

    // Run _checkAndLoadInitialChunk
    carousel['_checkAndLoadInitialChunk']();

    // Wait for any async calls
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect({
      count: carousel['_items'].length,
      ids: carousel['_items'].map((i) => i.getID()),
    }).toEqual({ count: 0, ids: [] });
  });
});

