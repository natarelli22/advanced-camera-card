/* eslint-disable @typescript-eslint/no-explicit-any */
import EmblaCarousel, { type EmblaCarouselType } from 'embla-carousel';
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedObject,
} from 'vitest';

import { CarouselController } from '../../../src/utils/embla/carousel-controller';
import {
  callMutationHandler,
  createParent,
  createSlot,
  createSlotHost,
  MutationObserverMock,
} from '../../test-utils';
import {
  callEmblaHandler,
  createEmblaApiInstance,
  createTestSlideNodes,
} from './test-utils';

vi.mock('embla-carousel', () => ({
  default: vi.fn().mockImplementation(() => {
    return createEmblaApiInstance();
  }),
}));

// Get the nth most recently constructed EmblaAPI instance.
const getEmblaApi = (n = 0): MockedObject<EmblaCarouselType> | null => {
  const constructions = vi.mocked(EmblaCarousel).mock.results;
  const mostRecentResult = constructions[constructions.length - 1 - n] ?? null;
  if (mostRecentResult && mostRecentResult.type === 'return') {
    return vi.mocked(mostRecentResult.value);
  }
  return null;
};

const createRoot = (): HTMLElement => {
  return document.createElement('div');
};

// @vitest-environment jsdom
describe('CarouselController', () => {
  beforeAll(() => {
    vi.stubGlobal('MutationObserver', MutationObserverMock);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);
    expect(carousel).toBeTruthy();
  });

  it('should construct with slot parent', () => {
    const slot = createSlot();
    const host = createSlotHost({ slot: slot, children: createTestSlideNodes() });
    const carousel = new CarouselController(host, slot);
    expect(carousel).toBeTruthy();
  });

  it('should destroy', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    carousel.destroy();

    expect(getEmblaApi()?.destroy).toHaveBeenCalled();
  });

  it('should destroy with slot', () => {
    const slot = createSlot();
    const host = createSlotHost({ slot: slot, children: createTestSlideNodes() });
    const carousel = new CarouselController(host, slot);

    carousel.destroy();

    expect(getEmblaApi()?.destroy).toHaveBeenCalled();
  });

  it('should get slide by index', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    getEmblaApi()?.slideNodes.mockReturnValue(children);
    expect(carousel.getSlide(2)).toBe(children[2]);
  });

  it('should get slide by index when index is invalid', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    expect(carousel.getSlide(1000)).toBeNull();
  });

  it('should get selected slide', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    getEmblaApi()?.slideNodes.mockReturnValue(children);
    getEmblaApi()?.selectedScrollSnap.mockReturnValue(3);
    expect(carousel.getSelectedIndex()).toBe(3);
    expect(carousel.getSelectedSlide()).toBe(children[3]);
  });

  it('should select given slide', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });

    const carousel = new CarouselController(createRoot(), parent);
    getEmblaApi()?.slideNodes.mockReturnValue(children);

    carousel.selectSlide(4);

    expect(getEmblaApi()?.scrollTo).toHaveBeenCalledWith(4, false);
  });

  it('should select given slide with jump', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });

    const carousel = new CarouselController(createRoot(), parent);
    getEmblaApi()?.slideNodes.mockReturnValue(children);

    carousel.selectSlide(4, true);

    expect(getEmblaApi()?.scrollTo).toHaveBeenCalledWith(4, true);
  });

  it('should call reInit on embla api with slides', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });

    const carousel = new CarouselController(createRoot(), parent);

    carousel.reInit();

    expect(getEmblaApi()?.reInit).toHaveBeenCalledWith({ slides: children });
  });

  it('should reinit with new slides when selecting newly added slide', () => {
    const children = createTestSlideNodes({ n: 5 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    expect(api).toBeTruthy();
    api?.slideNodes.mockReturnValue(children);

    const newChild = document.createElement('div');
    parent.appendChild(newChild);

    api?.reInit.mockImplementation(() => {
      api.slideNodes.mockReturnValue([...children, newChild]);
    });

    carousel.selectSlide(5);

    expect(api?.reInit).toHaveBeenCalledWith({
      slides: [...children, newChild],
    });
    expect(api?.scrollTo).toHaveBeenCalledWith(5, true);
  });

  it('should not select non-existent slide', () => {
    const children = createTestSlideNodes({ n: 10 });
    const parent = createParent({ children: children });

    const carousel = new CarouselController(createRoot(), parent);

    carousel.selectSlide(11);

    // Should not call scrollTo because index is out of bounds.
    expect(getEmblaApi()?.scrollTo).not.toHaveBeenCalled();
  });

  it('should dispatch select event', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    new CarouselController(createRoot(), parent);

    const selectHandler = vi.fn();
    parent.addEventListener('advanced-camera-card:carousel:select', selectHandler);

    getEmblaApi()?.selectedScrollSnap.mockReturnValue(6);
    getEmblaApi()?.slideNodes.mockReturnValue(children);
    callEmblaHandler(getEmblaApi(), 'select');

    expect(selectHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          index: 6,
          element: children[6],
        },
      }),
    );
  });

  it('should dispatch select event with slideRegistry when canScrollNext is true and false', () => {
    const children = createTestSlideNodes({ n: 10 });
    const parent = createParent({ children: children });
    new CarouselController(createRoot(), parent);

    const selectHandler = vi.fn();
    parent.addEventListener('advanced-camera-card:carousel:select', selectHandler);

    const api = getEmblaApi();
    api?.slideNodes.mockReturnValue(children);
    api?.internalEngine.mockReturnValue({
      slideRegistry: [
        [0, 1, 2],
        [3, 4, 5],
      ],
    } as any);

    // Can scroll next is true -> slideIndex is first slide in snap
    api?.selectedScrollSnap.mockReturnValue(1);
    api?.canScrollNext.mockReturnValue(true);
    callEmblaHandler(api, 'select');
    expect(selectHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          index: 1,
          slideIndex: 3,
        }),
      }),
    );

    // Can scroll next is false -> slideIndex is last slide in snap
    api?.canScrollNext.mockReturnValue(false);
    callEmblaHandler(api, 'select');
    expect(selectHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          index: 1,
          slideIndex: 5,
        }),
      }),
    );
  });

  it('should handle selectSlide when index is not found in slideRegistry', () => {
    const children = createTestSlideNodes({ n: 10 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    api?.slideNodes.mockReturnValue(children);
    api?.internalEngine.mockReturnValue({
      slideRegistry: [[0, 1]], // index 5 is not in slideRegistry
    } as any);

    carousel.selectSlide(5);
    expect(api?.scrollTo).toHaveBeenCalledWith(5, false);
  });

  it('should not dispatch anything with an invalid scroll snap', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    new CarouselController(createRoot(), parent);

    const selectHandler = vi.fn();
    parent.addEventListener('advanced-camera-card:carousel:select', selectHandler);

    getEmblaApi()?.selectedScrollSnap.mockReturnValue(1000);
    getEmblaApi()?.slideNodes.mockReturnValue(children);
    callEmblaHandler(getEmblaApi(), 'init');
    callEmblaHandler(getEmblaApi(), 'select');
    callEmblaHandler(getEmblaApi(), 'settle');

    expect(selectHandler).not.toHaveBeenCalled();
  });

  it('should honor creation options', () => {
    const children = createTestSlideNodes({ n: 1 });
    const root = createRoot();
    const parent = createParent({ children: children });

    new CarouselController(root, parent, {
      direction: 'vertical',
      transitionEffect: 'none',
      startIndex: 7,
      dragFree: true,
      loop: true,
      dragEnabled: false,
      textDirection: 'rtl',
    });

    expect(EmblaCarousel).toHaveBeenCalledWith(
      root,
      {
        slides: children,
        axis: 'y',
        duration: 20,
        startIndex: 7,
        dragFree: true,
        loop: true,
        containScroll: 'trimSnaps',
        watchSlides: false,
        watchResize: true,
        watchDrag: expect.any(Function),
        direction: 'rtl',
      },
      [],
    );
  });

  it('should pass a watchDrag predicate reflecting the current drag state', () => {
    const children = createTestSlideNodes();
    const root = createRoot();
    const parent = createParent({ children: children });

    const carousel = new CarouselController(root, parent, { dragEnabled: true });

    const emblaOptions = vi.mocked(EmblaCarousel).mock.calls[0][1] as {
      watchDrag: () => boolean;
    };
    expect(emblaOptions.watchDrag()).toBe(true);

    carousel.setDragEnabled(false);
    expect(emblaOptions.watchDrag()).toBe(false);

    carousel.setDragEnabled(true);
    expect(emblaOptions.watchDrag()).toBe(true);
  });

  it('should toggle drag without rebuilding the carousel', () => {
    const children = createTestSlideNodes();
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent, {
      dragEnabled: true,
    });

    const emblaApi = getEmblaApi();
    expect(emblaApi).toBeTruthy();

    carousel.setDragEnabled(false);
    expect(emblaApi?.reInit).not.toHaveBeenCalled();
    expect(emblaApi?.destroy).not.toHaveBeenCalled();
  });

  it('should include wheel plugin when slides > 1', () => {
    const children = createTestSlideNodes();
    const root = createRoot();
    const parent = createParent({ children: children });
    new CarouselController(root, parent);

    expect(EmblaCarousel).toHaveBeenCalledWith(
      root,
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          name: 'wheelGestures',
        }),
      ]),
    );
  });

  it('should not include wheel plugin when wheelScrolling is false', () => {
    const children = createTestSlideNodes();
    const root = createRoot();
    const parent = createParent({ children: children });
    new CarouselController(root, parent, { wheelScrolling: false });

    // Verify WheelGesturesPlugin is NOT present
    expect(EmblaCarousel).toHaveBeenCalledWith(
      root,
      expect.anything(),
      expect.not.arrayContaining([
        expect.objectContaining({
          name: 'wheelGestures',
        }),
      ]),
    );
  });

  it('should reinit carousel when children are added', () => {
    const children = createTestSlideNodes();
    const root = createRoot();
    const parent = createParent({ children: children });
    new CarouselController(root, parent);

    expect(EmblaCarousel).toHaveBeenCalledTimes(1);

    const originalEmblaApi = getEmblaApi();
    expect(originalEmblaApi).toBeTruthy();

    originalEmblaApi?.slideNodes.mockReturnValue(children);
    const newChild = document.createElement('div');
    parent.appendChild(newChild);
    callMutationHandler();

    // Should call reInit instead of destroy/recreate
    expect(originalEmblaApi?.reInit).toHaveBeenCalledWith({
      slides: [...children, newChild],
    });

    // Should still be same carousel instance (no new creation)
    expect(EmblaCarousel).toHaveBeenCalledTimes(1);
  });

  it('should not recreate carousel when children have not changed', () => {
    const children = createTestSlideNodes();
    const root = createRoot();
    const parent = createParent({ children: children });
    new CarouselController(root, parent);

    expect(EmblaCarousel).toHaveBeenCalledTimes(1);

    const originalEmblaApi = getEmblaApi();
    expect(originalEmblaApi).toBeTruthy();

    originalEmblaApi?.slideNodes.mockReturnValue(children);
    callMutationHandler();

    expect(originalEmblaApi?.destroy).not.toHaveBeenCalled();
    expect(getEmblaApi()).toBe(originalEmblaApi);

    expect(EmblaCarousel).toHaveBeenCalledTimes(1);
  });

  it('should reinit carousel when children are added to slot', () => {
    const children = createTestSlideNodes();
    const slot = createSlot();
    const host = createSlotHost({ slot: slot, children: children });

    new CarouselController(host, slot);

    expect(EmblaCarousel).toHaveBeenCalledTimes(1);

    const originalEmblaApi = getEmblaApi();
    expect(originalEmblaApi).toBeTruthy();

    originalEmblaApi?.slideNodes.mockReturnValue(children);

    const newChild = document.createElement('div');
    host.appendChild(newChild);
    slot.dispatchEvent(new Event('slotchange'));

    // Should call reInit instead of destroy/recreate
    expect(originalEmblaApi?.reInit).toHaveBeenCalledWith({
      slides: [...children, newChild],
    });

    // Should still be same carousel instance (no new creation)
    expect(EmblaCarousel).toHaveBeenCalledTimes(1);
  });

  it('should map slide index to snap index when slideRegistry is present', () => {
    const children = createTestSlideNodes({ n: 20 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    expect(api).toBeTruthy();
    api?.slideNodes.mockReturnValue(children);
    // 20 slides mapped into 5 snaps (4 slides each)
    const slideRegistry = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
      [12, 13, 14, 15],
      [16, 17, 18, 19],
    ];
    api?.internalEngine.mockReturnValue({
      options: { axis: 'x' },
      slideRegistry: slideRegistry,
    } as any);

    // Slide 9 belongs to snap 2
    carousel.selectSlide(9);
    expect(api?.scrollTo).toHaveBeenCalledWith(2, false);

    // Slide 18 belongs to snap 4
    carousel.selectSlide(18, true);
    expect(api?.scrollTo).toHaveBeenCalledWith(4, true);

    // isSlideInCurrentSnap
    api?.selectedScrollSnap.mockReturnValue(2);
    expect(carousel.isSlideInCurrentSnap(9)).toBe(true);
    expect(carousel.isSlideInCurrentSnap(10)).toBe(true);
    expect(carousel.isSlideInCurrentSnap(4)).toBe(false);

    // getSelectedIndex returns primary slide of current snap
    api?.canScrollNext.mockReturnValue(true);
    expect(carousel.getSelectedIndex()).toBe(8);

    // at end: getSelectedIndex returns last slide of end snap
    api?.selectedScrollSnap.mockReturnValue(4);
    api?.canScrollNext.mockReturnValue(false);
    expect(carousel.getSelectedIndex()).toBe(19);

    // getSelectedSnapIndex
    expect(carousel.getSelectedSnapIndex()).toBe(4);
  });

  it('should handle isSlideInCurrentSnap without slideRegistry', () => {
    const children = createTestSlideNodes({ n: 5 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    api?.internalEngine.mockReturnValue({} as any);
    api?.selectedScrollSnap.mockReturnValue(2);

    expect(carousel.isSlideInCurrentSnap(2)).toBe(true);
    expect(carousel.isSlideInCurrentSnap(1)).toBe(false);
  });

  it('should call translate.to on jump when engine supports it', () => {
    const children = createTestSlideNodes({ n: 5 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    api?.slideNodes.mockReturnValue(children);
    const mockTo = vi.fn();
    const mockGet = vi.fn().mockReturnValue(123);
    api?.internalEngine.mockReturnValue({
      translate: { to: mockTo },
      location: { get: mockGet },
    } as any);

    carousel.selectSlide(2, true);
    expect(mockGet).toHaveBeenCalled();
    expect(mockTo).toHaveBeenCalledWith(123);
  });

  it('should handle canScrollNext and canScrollPrev', () => {
    const children = createTestSlideNodes({ n: 5 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    api?.canScrollNext.mockReturnValue(true);
    api?.canScrollPrev.mockReturnValue(false);

    expect(carousel.canScrollNext()).toBe(true);
    expect(carousel.canScrollPrev()).toBe(false);
  });

  it('should handle isDragging states', () => {
    const children = createTestSlideNodes({ n: 5 });
    const parent = createParent({ children: children });
    const carousel = new CarouselController(createRoot(), parent);

    const api = getEmblaApi();
    api?.internalEngine.mockReturnValue(undefined as any);
    expect(carousel.isDragging()).toBe(false);

    api?.internalEngine.mockReturnValue({
      dragHandler: { pointerDown: vi.fn().mockReturnValue(true) },
      scrollBody: { settled: vi.fn().mockReturnValue(true) },
    } as any);
    expect(carousel.isDragging()).toBe(true);

    api?.internalEngine.mockReturnValue({
      dragHandler: { pointerDown: vi.fn().mockReturnValue(false) },
      scrollBody: { settled: vi.fn().mockReturnValue(false) },
    } as any);
    expect(carousel.isDragging()).toBe(true);

    api?.internalEngine.mockReturnValue({
      dragHandler: { pointerDown: vi.fn().mockReturnValue(false) },
      scrollBody: { settled: vi.fn().mockReturnValue(true) },
    } as any);
    expect(carousel.isDragging()).toBe(false);
  });
});
