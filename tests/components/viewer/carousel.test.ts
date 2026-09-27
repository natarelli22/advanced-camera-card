import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { CameraManager } from '../../../src/camera-manager/manager';
import type { CameraManagerReadOnlyConfigStore } from '../../../src/camera-manager/store';
import type { ViewManagerEpoch } from '../../../src/card-controller/view/types';
import type { AdvancedCameraCardViewerCarousel } from '../../../src/components/viewer/carousel';
import { QueryResults } from '../../../src/view/query-results';
import type { View } from '../../../src/view/view';
import { IntersectionObserverMock, ResizeObserverMock } from '../../test-utils';
import { TestViewMedia } from '../../view/test-utils';

import '../../../src/components/viewer/carousel';

// @vitest-environment jsdom
describe('AdvancedCameraCardViewerCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const createCarousel = (options?: {
    filterCameraID?: string;
    aspectRatio?: number[];
  }): {
    carousel: AdvancedCameraCardViewerCarousel;
    cameraManager: CameraManager;
  } => {
    const carousel = document.createElement(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel;
    document.body.appendChild(carousel);

    const cameraManager = mock<CameraManager>();
    const store = mock<CameraManagerReadOnlyConfigStore>();
    store.getCameraConfig.mockImplementation((id: string) => {
      if (id === (options?.filterCameraID ?? 'camera1')) {
        return {
          camera_entity: id,
          dimensions: options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : undefined,
        };
      }
      return null;
    });
    cameraManager.getStore.mockReturnValue(store);

    carousel.cameraManager = cameraManager;
    if (options?.filterCameraID) {
      carousel.viewFilterCameraID = options.filterCameraID;
    }

    return { carousel, cameraManager };
  };

  it('should toggle empty attribute when there is no media', async () => {
    const { carousel } = createCarousel({ filterCameraID: 'camera1' });

    const view = mock<View>();
    view.camera = 'camera1';
    view.isAnyMediaView.mockReturnValue(true);
    view.isGrid.mockReturnValue(true);
    view.queryResults = null;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    carousel.viewManagerEpoch = epoch;
    await carousel.updateComplete;

    expect(carousel.hasAttribute('empty')).toBe(true);
  });

  it('should toggle empty attribute when in grid and no item is selected', async () => {
    const { carousel } = createCarousel({ filterCameraID: 'camera1' });

    const media = new TestViewMedia({ id: 'media-1', cameraID: 'camera1' });
    const queryResults = new QueryResults({ results: [media], selectedIndex: null });

    const view = mock<View>();
    view.camera = 'camera1';
    view.isAnyMediaView.mockReturnValue(true);
    view.isGrid.mockReturnValue(true);
    view.queryResults = queryResults;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    carousel.viewManagerEpoch = epoch;
    await carousel.updateComplete;

    expect(carousel.hasAttribute('empty')).toBe(true);
    expect(carousel.hasAttribute('unseekable')).toBe(false);
  });

  it('should remove empty attribute when in grid and an item is selected', async () => {
    const { carousel } = createCarousel({ filterCameraID: 'camera1' });

    const media = new TestViewMedia({ id: 'media-1', cameraID: 'camera1' });
    const queryResults = new QueryResults({ results: [media], selectedIndex: 0 });

    const view = mock<View>();
    view.camera = 'camera1';
    view.isAnyMediaView.mockReturnValue(true);
    view.isGrid.mockReturnValue(true);
    view.queryResults = queryResults;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    carousel.viewManagerEpoch = epoch;
    await carousel.updateComplete;

    expect(carousel.hasAttribute('empty')).toBe(false);
  });

  it('should set aspect-ratio CSS property when camera has configured aspect ratio', async () => {
    const { carousel } = createCarousel({
      filterCameraID: 'camera1',
      aspectRatio: [4, 3],
    });

    const view = mock<View>();
    view.camera = 'camera1';
    view.isAnyMediaView.mockReturnValue(false);
    view.queryResults = null;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    carousel.viewManagerEpoch = epoch;
    await carousel.updateComplete;

    expect(
      carousel.style.getPropertyValue('--advanced-camera-card-camera-aspect-ratio'),
    ).toBe('4 / 3');
  });

  it('should remove aspect-ratio CSS property when camera has no configured aspect ratio', async () => {
    const { carousel } = createCarousel({
      filterCameraID: 'camera1',
    });

    const view = mock<View>();
    view.camera = 'camera1';
    view.isAnyMediaView.mockReturnValue(false);
    view.queryResults = null;

    const epoch: ViewManagerEpoch = {
      manager: {
        getView: () => view,
      } as unknown as ViewManagerEpoch['manager'],
    };

    carousel.viewManagerEpoch = epoch;
    await carousel.updateComplete;

    expect(
      carousel.style.getPropertyValue('--advanced-camera-card-camera-aspect-ratio'),
    ).toBe('');
  });
});
