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

  it('should calculate drawer button top for position top and bottom', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    const mainChild = document.createElement('div');
    element.appendChild(mainChild);

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
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

    // top: 25% of 400 = 100px
    element.thumbnailConfig = {
      mode: 'right',
      position: 'top',
    } as unknown as typeof element.thumbnailConfig;
    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('100px');

    // bottom: 75% of 400 = 300px
    element.thumbnailConfig = {
      mode: 'right',
      position: 'bottom',
    } as unknown as typeof element.thumbnailConfig;
    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('300px');

    // custom percent '10%' of 400 = 40px
    element.thumbnailConfig = {
      mode: 'right',
      position: '10%',
    } as unknown as typeof element.thumbnailConfig;
    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('40px');

    // custom pixel 150
    element.thumbnailConfig = {
      mode: 'right',
      position: 150,
    } as unknown as typeof element.thumbnailConfig;
    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('150px');

    document.body.removeChild(element);
  });

  it('should calculate drawer button top for position selected', () => {
    const element = document.createElement(
      'advanced-camera-card-surround-basic',
    ) as AdvancedCameraCardSurroundBasic;
    document.body.appendChild(element);

    const mainChild = document.createElement('div');
    const cell1 = document.createElement('div');
    const cell2 = document.createElement('div');
    cell2.setAttribute('selected', '');
    mainChild.appendChild(cell1);
    mainChild.appendChild(cell2);
    element.appendChild(mainChild);

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
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

    // Cell 2 (selected) is at top: 200, height: 200 -> center should be 200 + 100 = 300px
    vi.spyOn(cell2, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      height: 200,
      bottom: 400,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    });

    element.thumbnailConfig = {
      mode: 'right',
      position: 'selected',
    } as unknown as typeof element.thumbnailConfig;
    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('300px');

    // When cell 1 is selected instead: top: 0, height: 200 -> center should be 0 + 100 = 100px
    cell2.removeAttribute('selected');
    cell1.setAttribute('selected', '');
    vi.spyOn(cell1, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 200,
      bottom: 200,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('100px');

    // Fallback when nothing is selected
    cell1.removeAttribute('selected');
    (
      element as unknown as { _updateDrawerButtonPosition: () => void }
    )._updateDrawerButtonPosition();
    expect(
      element.style.getPropertyValue('--advanced-camera-card-drawer-button-top'),
    ).toBe('200px');

    document.body.removeChild(element);
  });
});
