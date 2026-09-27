import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { IntersectionObserverMock, ResizeObserverMock } from '../../test-utils';

import '../../../src/components/viewer/grid';

import type { CameraManager } from '../../../src/camera-manager/manager';
import type { CameraManagerReadOnlyConfigStore } from '../../../src/camera-manager/store';
import type { ViewManagerEpoch } from '../../../src/card-controller/view/types';
import type { AdvancedCameraCardViewerCarousel } from '../../../src/components/viewer/carousel';
import type { AdvancedCameraCardViewerGrid } from '../../../src/components/viewer/grid';
import type { ViewerConfig } from '../../../src/config/schema/viewer';
import type { ViewMedia } from '../../../src/view/item';
import type { View } from '../../../src/view/view';

// @vitest-environment jsdom
describe('AdvancedCameraCardViewerGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const createGrid = (options?: {
    camera?: string;
    syncPlayback?: boolean;
  }): {
    grid: AdvancedCameraCardViewerGrid;
    carousel1: AdvancedCameraCardViewerCarousel;
    carousel2: AdvancedCameraCardViewerCarousel;
  } => {
    const grid = document.createElement(
      'advanced-camera-card-viewer-grid',
    ) as AdvancedCameraCardViewerGrid;
    document.body.appendChild(grid);

    const view = mock<View>();
    view.camera = options?.camera ?? 'camera1';
    view.queryResults = null;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    grid.viewManagerEpoch = epoch;
    grid.viewerConfig = {
      grid: {
        sync_playback: options?.syncPlayback ?? true,
      },
    } as unknown as ViewerConfig;

    const carousel1 = document.createElement(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel;
    carousel1.viewFilterCameraID = 'camera1';
    carousel1.pause = vi.fn();
    carousel1.play = vi.fn();
    carousel1.seek = vi.fn();

    const carousel2 = document.createElement(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel;
    carousel2.viewFilterCameraID = 'camera2';
    carousel2.pause = vi.fn();
    carousel2.play = vi.fn();
    carousel2.seek = vi.fn();

    // Attach to grid's renderRoot / shadowRoot
    vi.spyOn(grid.renderRoot, 'querySelectorAll').mockImplementation(
      (selector: string) => {
        if (selector === 'advanced-camera-card-viewer-carousel') {
          return [carousel1, carousel2] as unknown as NodeListOf<Element>;
        }
        return [] as unknown as NodeListOf<Element>;
      },
    );

    return { grid, carousel1, carousel2 };
  };

  it('should pause all carousels on media:ended', () => {
    const { grid, carousel1, carousel2 } = createGrid({ syncPlayback: true });

    const targetEl = document.createElement('video');
    carousel1.appendChild(targetEl);

    const event = new CustomEvent('advanced-camera-card:media:ended', {
      bubbles: true,
      composed: true,
    });
    targetEl.dispatchEvent(event);

    (grid as unknown as { _handleMediaEnded: (ev: Event) => void })._handleMediaEnded({
      ...event,
      target: targetEl,
    });

    expect(carousel1.pause).toHaveBeenCalled();
    expect(carousel2.pause).toHaveBeenCalled();
  });

  it('should not pause carousels on media:ended if sync_playback is false', () => {
    const { grid, carousel1, carousel2 } = createGrid({ syncPlayback: false });

    const targetEl = document.createElement('video');
    carousel1.appendChild(targetEl);

    (grid as unknown as { _handleMediaEnded: (ev: Event) => void })._handleMediaEnded({
      target: targetEl,
    } as unknown as Event);

    expect(carousel1.pause).not.toHaveBeenCalled();
    expect(carousel2.pause).not.toHaveBeenCalled();
  });

  it('should synchronize play from selected camera to other carousels', () => {
    const { grid, carousel1, carousel2 } = createGrid({ syncPlayback: true });

    const targetEl = document.createElement('video');
    carousel1.appendChild(targetEl);

    (grid as unknown as { _handleMediaPlay: (ev: Event) => void })._handleMediaPlay({
      target: targetEl,
    } as unknown as Event);

    expect(carousel2.play).toHaveBeenCalled();
    expect(carousel1.play).not.toHaveBeenCalled();
  });

  it('should synchronize pause from selected camera to other carousels', () => {
    const { grid, carousel1, carousel2 } = createGrid({ syncPlayback: true });

    const targetEl = document.createElement('video');
    carousel1.appendChild(targetEl);

    (grid as unknown as { _handleMediaPause: (ev: Event) => void })._handleMediaPause({
      target: targetEl,
    } as unknown as Event);

    expect(carousel2.pause).toHaveBeenCalled();
    expect(carousel1.pause).not.toHaveBeenCalled();
  });

  it('should ignore play/pause from non-selected camera', () => {
    const { grid, carousel1, carousel2 } = createGrid({
      syncPlayback: true,
      camera: 'camera1',
    });

    const targetEl = document.createElement('video');
    carousel2.appendChild(targetEl);

    (grid as unknown as { _handleMediaPlay: (ev: Event) => void })._handleMediaPlay({
      target: targetEl,
    } as unknown as Event);

    expect(carousel1.play).not.toHaveBeenCalled();
    expect(carousel2.play).not.toHaveBeenCalled();
  });

  it('should synchronize seeked time to other carousels covering the target time', () => {
    const { grid, carousel1, carousel2 } = createGrid({
      syncPlayback: true,
      camera: 'camera1',
    });

    const targetEl = document.createElement('video');
    carousel1.appendChild(targetEl);

    // Media 1 starts at 10:00:00 (Unix: 1000s)
    const media1 = mock<ViewMedia>();
    media1.getStartTime.mockReturnValue(new Date(1000 * 1000));
    carousel1.getSelectedMedia = vi.fn().mockReturnValue(media1);

    // Media 2 starts at 09:30:00 (Unix: 0s, ends at 3600s)
    const media2 = mock<ViewMedia>();
    media2.getStartTime.mockReturnValue(new Date(0));
    media2.includesTime.mockReturnValue(true);
    carousel2.getSelectedMedia = vi.fn().mockReturnValue(media2);

    // Seeked to 30s into Media 1 -> Real time is 1000 + 30 = 1030s
    // Media 2 offset should be 1030 - 0 = 1030s
    const seekEvent = new CustomEvent('advanced-camera-card:media:seeked', {
      detail: { currentTime: 30 },
    });

    (
      grid as unknown as {
        _handleMediaSeeked: (ev: CustomEvent<{ currentTime?: number }>) => void;
      }
    )._handleMediaSeeked({
      ...seekEvent,
      target: targetEl,
      detail: { currentTime: 30 },
    } as unknown as CustomEvent<{ currentTime?: number }>);

    expect(carousel2.seek).toHaveBeenCalledWith(1030);
  });

  it('should render carousels in configured camera order via cameraManager', () => {
    const grid = document.createElement(
      'advanced-camera-card-viewer-grid',
    ) as AdvancedCameraCardViewerGrid;

    const view = mock<View>();
    view.camera = 'camera1';
    view.isGrid.mockReturnValue(true);
    view.supportsMultipleDisplayModes.mockReturnValue(true);
    view.queryResults = null;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerReadOnlyConfigStore>();
    store.getCameraIDs.mockReturnValue(new Set(['camera1', 'camera2']));
    store.getCameraConfig.mockReturnValue(null);
    cameraManager.getStore.mockReturnValue(store);

    grid.cameraManager = cameraManager;
    grid.viewManagerEpoch = epoch;
    grid.viewerConfig = {} as unknown as ViewerConfig;

    const cameraIDs = (
      grid as unknown as { _getGridCameraIDs: () => Set<string> | null }
    )._getGridCameraIDs();
    expect(cameraIDs).toEqual(new Set(['camera1', 'camera2']));
  });
});
