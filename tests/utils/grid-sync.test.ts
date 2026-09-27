import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { CameraManager } from '../../src/camera-manager/manager.js';
import type { CameraManagerStore } from '../../src/camera-manager/store.js';
import { QueryType } from '../../src/camera-manager/types.js';
import { QuerySource } from '../../src/query-source.js';
import { syncGridResultsForTargetTime } from '../../src/utils/grid-sync.js';
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

  it('should query event/clip media if other camera has clips but not recordings', async () => {
    const targetTime = new Date('2024-01-01T10:15:00Z');

    const mediaCam1 = new TestViewMedia({
      id: 'media-1',
      cameraID: 'camera1',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:30:00Z'),
    });

    const clipCam2 = new TestViewMedia({
      id: 'clip-2',
      cameraID: 'camera2',
      startTime: new Date('2024-01-01T10:10:00Z'),
      endTime: new Date('2024-01-01T10:20:00Z'),
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

    cameraManager.executeMediaQueries.mockResolvedValue([clipCam2]);

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
          type: QueryType.Event,
          cameraIDs: new Set(['camera2']),
        }),
      ],
      { useCache: true },
    );

    expect(synced.getSelectedResult('camera1')?.getID()).toBe('media-1');
    expect(synced.getSelectedResult('camera2')?.getID()).toBe('clip-2');
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
});
