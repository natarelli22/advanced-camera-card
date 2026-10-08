import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { CameraManager } from '../../src/camera-manager/manager.js';
import type { CameraManagerStore } from '../../src/camera-manager/store.js';
import { QueryType } from '../../src/camera-manager/types.js';
import { QuerySource } from '../../src/query-source.js';
import { syncGridResultsForTargetTime } from '../../src/utils/grid-sync.js';
import { ViewItemClassifier } from '../../src/view/item-classifier.js';
import { ViewMediaType } from '../../src/view/item.js';
import { QueryResults } from '../../src/view/query-results.js';
import { TestViewMedia } from '../view/test-utils.js';

describe('syncGridResultsForTargetTime', () => {
  it('should select matching media for other camera when already present in results', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const mediaCam2 = new TestViewMedia({
      id: 'media-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const results = new QueryResults({ results: [mediaCam1, mediaCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('media-2');
    expect(synced.getSelectedResult()?.getID()).toBe('media-1');
  });

  it('should query recording media for other camera if not present in results', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const mediaCam2 = new TestViewMedia({
      id: 'media-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'recordings' || cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    cameraManager.executeMediaQueries.mockResolvedValue([mediaCam2]);

    const results = new QueryResults({ results: [mediaCam1] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(cameraManager.executeMediaQueries).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          source: QuerySource.Camera,
          type: QueryType.Recording,
          cameraIDs: new Set(['camera2']),
        }),
      ],
      { useCache: true },
    );

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('media-2');
  });

  it('should not query event media and leave camera unselected if other camera lacks continuous recordings', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      if (cap === 'clips') {
        return new Set(['camera2']);
      }
      return new Set();
    });

    const results = new QueryResults({ results: [mediaCam1] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(cameraManager.executeMediaQueries).not.toHaveBeenCalled();
    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')).toBeNull();
  });

  it('should skip querying camera if it has neither recordings nor clips', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    const results = new QueryResults({ results: [mediaCam1] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(cameraManager.executeMediaQueries).not.toHaveBeenCalled();
    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')).toBeNull();
  });

  it('should handle undefined cameraManager and omitted selectedItemID', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const results = new QueryResults({ results: [mediaCam1] });

    const synced = await syncGridResultsForTargetTime(results, {
      targetTime,
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
  });

  it('should skip querying cameraManager if other camera already has covering media', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const mediaCam2 = new TestViewMedia({
      id: 'media-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'live' || cap === 'recordings') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    const results = new QueryResults({ results: [mediaCam1, mediaCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(cameraManager.executeMediaQueries).not.toHaveBeenCalled();
    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('media-2');
  });

  it('should query cameraManager when existing selected media for other camera does not cover targetTime', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    // Existing media is at 08:00 - 08:30 (does not cover 10:15)
    const oldMediaCam2 = new TestViewMedia({
      id: 'media-old-2',
      cameraID: 'camera2',
      startTime: new Date('2024-01-01T08:00:00Z'),
      endTime: new Date('2024-01-01T08:30:00Z'),
    });

    const newMediaCam2 = new TestViewMedia({
      id: 'media-new-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'live' || cap === 'recordings') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });
    cameraManager.executeMediaQueries.mockResolvedValue([newMediaCam2]);

    const results = new QueryResults({ results: [mediaCam1, oldMediaCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(cameraManager.executeMediaQueries).toHaveBeenCalled();
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('media-new-2');
  });

  it('should handle executeMediaQueries returning empty or null', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'live' || cap === 'recordings') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });
    cameraManager.executeMediaQueries.mockResolvedValue(null);

    const results = new QueryResults({ results: [mediaCam1] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(cameraManager.executeMediaQueries).toHaveBeenCalled();
    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')).toBeNull();
  });

  it('should reset selection for other camera if existing media does not cover targetTime and cannot be synced', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const oldMediaCam2 = new TestViewMedia({
      id: 'media-old-2',
      cameraID: 'camera2',
      startTime: new Date('2024-01-01T08:00:00Z'),
      endTime: new Date('2024-01-01T08:30:00Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    const results = new QueryResults({ results: [mediaCam1, oldMediaCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')).toBeNull();
  });

  it('should not select event for secondary camera even if it covers targetTime', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const eventCam2 = new TestViewMedia({
      id: 'event-cam-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Clip,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const results = new QueryResults({ results: [mediaCam1, eventCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')).toBeNull();
  });

  it('should select recording for secondary camera when targetTime is within boundary tolerance', async () => {
    // targetTime is 2 seconds before the recording starts (e.g. clock drift or segment gap)
    const targetTime = new Date('2024-01-01T10:00:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      mediaType: ViewMediaType.Clip,
      startTime: targetTime,
      endTime: new Date('2024-01-01T10:00:20Z'),
    });

    const mediaCam2 = new TestViewMedia({
      id: 'media-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2024-01-01T10:00:02Z'), // starts 2s after targetTime
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const results = new QueryResults({ results: [mediaCam1, mediaCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('media-2');
  });

  it('should not select recording for secondary camera when targetTime exceeds boundary tolerance', async () => {
    // targetTime is 25 seconds before the recording starts
    const targetTime = new Date('2024-01-01T09:59:35Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      mediaType: ViewMediaType.Clip,
      startTime: targetTime,
      endTime: new Date('2024-01-01T10:00:00Z'),
    });

    const mediaCam2 = new TestViewMedia({
      id: 'media-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2024-01-01T10:00:02Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const results = new QueryResults({ results: [mediaCam1, mediaCam2] });

    const synced = await syncGridResultsForTargetTime(results, {
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'media-1',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')).toBeNull();
  });

  it('should seamlessly switch between events requiring different continuous recording files and preserve active event in _main', async () => {
    // Cam 1 has two events at different times
    const event1 = new TestViewMedia({
      id: 'event-1',
      cameraID: 'camera1',
      mediaType: ViewMediaType.Clip,
      startTime: new Date('2026-09-28T17:44:36Z'),
      endTime: new Date('2026-09-28T17:45:00Z'),
    });

    const event2 = new TestViewMedia({
      id: 'event-2',
      cameraID: 'camera1',
      mediaType: ViewMediaType.Clip,
      startTime: new Date('2026-09-28T17:14:15Z'),
      endTime: new Date('2026-09-28T17:14:40Z'),
    });

    // Cam 2 has continuous recordings split in 30-min chunks
    const recChunk1 = new TestViewMedia({
      id: 'rec-chunk-1',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2026-09-28T16:54:35Z'),
      endTime: new Date('2026-09-28T17:23:59Z'), // covers 17:14:15
    });

    const recChunk2 = new TestViewMedia({
      id: 'rec-chunk-2',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2026-09-28T17:23:59Z'),
      endTime: new Date('2026-09-28T17:54:27Z'), // covers 17:44:36
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'recordings' || cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    // Initially, user was on event1 with recChunk2 loaded
    const initialResults = new QueryResults({
      results: [event1, event2, recChunk2],
      selectedIndex: 0,
    });
    initialResults.selectResultIfFound((m) => m === event1, {
      cameraID: 'camera1',
      main: true,
    });
    initialResults.selectResultIfFound((m) => m === recChunk2, { cameraID: 'camera2' });

    expect(initialResults.getSelectedResult('camera1')?.getID()).toBe('event-1');
    expect(initialResults.getSelectedResult('camera2')?.getID()).toBe('rec-chunk-2');
    expect(initialResults.getSelectedResult()?.getID()).toBe('event-1');

    // When switching to event2 (17:14:15), recChunk2 does not cover 17:14:15.
    // executeMediaQueries will return recChunk1.
    cameraManager.executeMediaQueries.mockResolvedValue([recChunk1]);

    const synced = await syncGridResultsForTargetTime(initialResults, {
      cameraManager,
      targetTime: new Date('2026-09-28T17:14:15Z'),
      selectedCameraID: 'camera1',
      selectedItemID: 'event-2',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    expect(synced.hasSelectedResult()).toBe(true);
    expect(synced.getSelectedResult()?.getID()).toBe('event-2');
    expect(synced.getSelectedResult('camera1')?.getID()).toBe('event-2');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('rec-chunk-1');
  });

  it('should deduplicate recordings if already present in results', async () => {
    const event = new TestViewMedia({
      id: 'event-1',
      cameraID: 'camera1',
      mediaType: ViewMediaType.Clip,
      startTime: new Date('2026-09-28T17:14:15Z'),
      endTime: new Date('2026-09-28T17:14:40Z'),
    });

    const recChunk1 = new TestViewMedia({
      id: 'rec-chunk-1',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2026-09-28T16:54:35Z'),
      endTime: new Date('2026-09-28T17:23:59Z'),
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'recordings' || cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    // executeMediaQueries returns recChunk1 which is already in results
    cameraManager.executeMediaQueries.mockResolvedValue([recChunk1]);

    const initialResults = new QueryResults({
      results: [event, recChunk1],
      selectedIndex: 0,
    });

    const synced = await syncGridResultsForTargetTime(initialResults, {
      cameraManager,
      targetTime: new Date('2026-09-28T17:14:15Z'),
      selectedCameraID: 'camera1',
      selectedItemID: 'event-1',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    const cam2Results = synced.getResults('camera2') ?? [];
    expect(cam2Results.length).toBe(1);
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('rec-chunk-1');
    expect(synced.getSelectedResult('camera1')?.getID()).toBe('event-1');
  });

  it('should not discard recording when an event with the same ID already exists in results and select the covering recording', async () => {
    const targetTime = new Date('2026-10-01T22:52:13Z');

    const eventCam1 = new TestViewMedia({
      id: 'event-cam1',
      cameraID: 'camera1',
      mediaType: ViewMediaType.Clip,
      startTime: targetTime,
      endTime: new Date('2026-10-01T22:52:43Z'),
    });

    // An existing short clip on camera2 with the same ID as the future recording chunk
    const shortClipCam2 = new TestViewMedia({
      id: 'camera2/2026-10-01 22:45:40',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Clip,
      startTime: new Date('2026-10-01T22:45:40Z'),
      endTime: new Date('2026-10-01T22:47:08Z'), // Ended before targetTime!
    });

    // The continuous recording from cameraManager covering targetTime
    const coveringRecCam2 = new TestViewMedia({
      id: 'camera2/2026-10-01 22:45:40',
      cameraID: 'camera2',
      mediaType: ViewMediaType.Recording,
      startTime: new Date('2026-10-01T22:45:40Z'),
      endTime: new Date('2026-10-01T23:23:09Z'), // Covers targetTime!
    });

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerStore>();
    cameraManager.getStore.mockReturnValue(store);
    store.getCameraIDsWithCapability.mockImplementation((cap) => {
      if (cap === 'recordings' || cap === 'live') {
        return new Set(['camera1', 'camera2']);
      }
      return new Set();
    });

    cameraManager.executeMediaQueries.mockResolvedValue([coveringRecCam2]);

    const initialResults = new QueryResults({
      results: [eventCam1, shortClipCam2],
      selectedIndex: 0,
    });

    const synced = await syncGridResultsForTargetTime(initialResults, {
      cameraManager,
      targetTime,
      selectedCameraID: 'camera1',
      selectedItemID: 'event-cam1',
      gridCameraIDs: new Set(['camera1', 'camera2']),
    });

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('event-cam1');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe(
      'camera2/2026-10-01 22:45:40',
    );
    expect(ViewItemClassifier.isRecording(synced.getSelectedResult('camera2'))).toBe(
      true,
    );
  });
});
