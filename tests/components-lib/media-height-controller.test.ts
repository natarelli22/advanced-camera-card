import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import screenfull from 'screenfull';
import {
  MediaHeightController,
  SET_HEIGHT_DEBOUNCE_SECONDS,
} from '../../src/components-lib/media-height-controller';
import {
  callMutationHandler,
  callResizeHandler,
  MutationObserverMock,
  ResizeObserverMock,
  setScreenfulEnabled,
} from '../test-utils';

vi.mock('screenfull', () => ({
  default: {
    exit: vi.fn(),
    request: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
  },
}));

// @vitest-environment jsdom
describe('MediaHeightController', () => {
  beforeAll(() => {
    vi.stubGlobal('MutationObserver', MutationObserverMock);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });
    setScreenfulEnabled(false);
  });

  describe('should set height', () => {
    it('should set height on selection', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child = document.createElement('div');
      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 600,
      });
      root.appendChild(child);

      controller.setRoot(root);

      // Calling a second time has no effect.
      controller.setRoot(root);

      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe(`600px`);
    });

    it('should not set height without children', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');

      controller.setRoot(root);

      controller.setSelected(10);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('');
    });

    it('should respond to resize observer of selected child', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child = document.createElement('div');
      root.appendChild(child);

      controller.setRoot(root);
      controller.setSelected(0);

      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 800,
      });

      callResizeHandler([
        {
          target: child,
          height: 800,
          width: 400,
        },
      ]);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('800px');
    });

    it('should not respond to resize observer without a selected child', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child = document.createElement('div');
      root.appendChild(child);

      controller.setRoot(root);

      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 800,
      });

      callResizeHandler([
        {
          target: child,
          height: 800,
          width: 400,
        },
      ]);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('');
    });

    it('should respond to new children being added', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child_0 = document.createElement('div');
      child_0.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 100,
      });
      root.appendChild(child_0);

      controller.setRoot(root);

      const child_1 = document.createElement('div');
      child_1.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 200,
      });
      root.appendChild(child_1);

      callMutationHandler();

      controller.setSelected(1);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('200px');
    });

    it('should set height on recalculate', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child = document.createElement('div');
      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 700,
      });
      root.appendChild(child);

      controller.setRoot(root);
      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('700px');

      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 900,
      });

      controller.recalculate();

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('900px');
    });

    it('should not set height when the selected child has no height', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child = document.createElement('div');
      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 0,
      });
      root.appendChild(child);

      controller.setRoot(root);
      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('');
    });

    it('should allow height to shrink when selected child is shorter', () => {
      const host = document.createElement('div');
      const controller = new MediaHeightController(host, 'div');

      const root = document.createElement('div');
      const child_0 = document.createElement('div');
      child_0.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 750,
      });
      const child_1 = document.createElement('div');
      child_1.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 562,
      });
      root.appendChild(child_0);
      root.appendChild(child_1);

      controller.setRoot(root);
      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('750px');

      controller.setSelected(1);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('562px');
    });
  });

  describe('fullscreen handling', () => {
    it('should not set maxHeight when host is in fullscreen', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      Object.defineProperty(document, 'fullscreenElement', {
        value: host,
        configurable: true,
        writable: true,
      });

      const controller = new MediaHeightController(host, 'div');
      const root = document.createElement('div');
      const child = document.createElement('div');
      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 600,
      });
      root.appendChild(child);

      controller.setRoot(root);
      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('');
      host.remove();
    });

    it('should detect fullscreen through shadow root ancestor', () => {
      const outer = document.createElement('div');
      const shadowRoot = outer.attachShadow({ mode: 'open' });
      const host = document.createElement('div');
      shadowRoot.appendChild(host);
      document.body.appendChild(outer);

      Object.defineProperty(document, 'fullscreenElement', {
        value: outer,
        configurable: true,
        writable: true,
      });

      const controller = new MediaHeightController(host, 'div');
      const root = document.createElement('div');
      const child = document.createElement('div');
      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 600,
      });
      root.appendChild(child);

      controller.setRoot(root);
      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

      expect(host.style.maxHeight).toBe('');
      outer.remove();
    });

    it('should clear maxHeight on fullscreenchange when entering fullscreen and restore on exit', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const controller = new MediaHeightController(host, 'div');
      const root = document.createElement('div');
      const child = document.createElement('div');
      child.getBoundingClientRect = vi.fn().mockReturnValue({
        height: 600,
      });
      root.appendChild(child);

      controller.setRoot(root);
      controller.setSelected(0);

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);
      expect(host.style.maxHeight).toBe('600px');

      // Enter fullscreen
      Object.defineProperty(document, 'fullscreenElement', {
        value: host,
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));

      expect(host.style.maxHeight).toBe('');

      // Exit fullscreen
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));

      vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);
      expect(host.style.maxHeight).toBe('600px');

      host.remove();
    });

    it('should handle screenfull change event when screenfull is enabled', () => {
      setScreenfulEnabled(true);
      const host = document.createElement('div');
      document.body.appendChild(host);

      const controller = new MediaHeightController(host, 'div');
      expect(vi.mocked(screenfull.on)).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );

      controller.destroy();
      expect(vi.mocked(screenfull.off)).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );

      host.remove();
    });
  });

  it('should clean up on destroy', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const controller = new MediaHeightController(host, 'div');
    const root = document.createElement('div');
    const child = document.createElement('div');
    child.getBoundingClientRect = vi.fn().mockReturnValue({
      height: 600,
    });
    root.appendChild(child);
    controller.setRoot(root);
    controller.setSelected(0);

    controller.destroy();

    // Dispatch fullscreen change after destroy
    Object.defineProperty(document, 'fullscreenElement', {
      value: host,
      configurable: true,
      writable: true,
    });
    document.dispatchEvent(new Event('fullscreenchange'));

    vi.advanceTimersByTime(SET_HEIGHT_DEBOUNCE_SECONDS * 1000);

    // Pending setHeight should be canceled and listener removed
    expect(host.style.maxHeight).toBe('');

    host.remove();
  });
});
