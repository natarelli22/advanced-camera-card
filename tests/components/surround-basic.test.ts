import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/components/surround-basic';

import type { AdvancedCameraCardSurroundBasic } from '../../src/components/surround-basic';
import {
  callResizeHandler,
  getResizeObserver,
  ResizeObserverMock,
  stubMatchMedia,
} from '../test-utils';

// @vitest-environment jsdom
describe('AdvancedCameraCardSurroundBasic', () => {
  beforeEach(() => {
    stubMatchMedia().mockReturnValue({ matches: true } as MediaQueryList);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.mocked(ResizeObserver).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('should calculate drawer button top correctly', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    const mainChild = document.createElement('div');
    element.appendChild(mainChild);

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      height: 400,
      bottom: 500,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    vi.spyOn(mainChild, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      height: 300,
      bottom: 400,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();

    // Center should be (100 - 100) + 300 / 2 = 150px
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('150px');

    document.body.removeChild(element);
  });

  it('should calculate drawer button top when offset by an element above', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    const mainChild = document.createElement('div');
    element.appendChild(mainChild);

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      height: 450,
      bottom: 550,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    // 50px offset from top of surround-basic, 300px height
    vi.spyOn(mainChild, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      height: 300,
      bottom: 450,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 150,
      toJSON: () => ({}),
    });

    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();

    // Center should be (150 - 100) + 300 / 2 = 50 + 150 = 200px
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('200px');

    document.body.removeChild(element);
  });

  it('should remove custom property when there is no main element', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    element.style.setProperty('--advanced-camera-card-drawer-button-top', '150px');

    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();

    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('');

    document.body.removeChild(element);
  });

  it('should handle drawer open and close events', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    element.dispatchEvent(
      new CustomEvent('advanced-camera-card:drawer:open', {
        detail: { drawer: 'right' },
      }),
    );

    element.dispatchEvent(
      new CustomEvent('advanced-camera-card:drawer:close', {
        detail: { drawer: 'right' },
      }),
    );

    document.body.removeChild(element);
  });

  it('should update drawer button top on resize observer trigger', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    const mainChild = document.createElement('div');
    element.appendChild(mainChild);

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 600,
      bottom: 600,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    vi.spyOn(mainChild, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 400,
      bottom: 400,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    callResizeHandler([], 0);

    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('200px');

    document.body.removeChild(element);
  });

  it('should disconnect resize observer when removed from DOM', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    const observer = getResizeObserver(0);
    expect(observer?.observe).toHaveBeenCalled();

    document.body.removeChild(element);
    expect(observer?.disconnect).toHaveBeenCalled();
  });
});
