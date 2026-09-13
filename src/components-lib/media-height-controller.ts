import { debounce, isEqual } from 'lodash-es';
import screenfull from 'screenfull';

// Balancing act: Debounce to avoid excessive calls to setHeight, when new media
// is loading the player may be a much smaller height momentarily.
export const SET_HEIGHT_DEBOUNCE_SECONDS = 0.3;

export class MediaHeightController {
  private _host: HTMLElement;
  private _selector: string;

  private _root: HTMLElement | DocumentFragment | null = null;
  private _children: HTMLElement[] = [];
  private _selectedChild: HTMLElement | null = null;

  private _mutationObserver = new MutationObserver(() => this._initializeRoot());
  private _resizeObserver = new ResizeObserver(() => this._debouncedSetHeight());

  private _debouncedSetHeight = debounce(
    () => this._setHeight(),
    SET_HEIGHT_DEBOUNCE_SECONDS * 1000,
    {
      trailing: true,
      leading: false,
    },
  );

  constructor(host: HTMLElement, selector: string) {
    this._host = host;
    this._selector = selector;

    if (screenfull.isEnabled) {
      screenfull.on('change', this._fullscreenHandler);
    }
    document.addEventListener('fullscreenchange', this._fullscreenHandler);
    document.addEventListener('webkitfullscreenchange', this._fullscreenHandler);
  }

  public setRoot(root: HTMLElement | DocumentFragment): void {
    if (root === this._root) {
      return;
    }

    this._root = root;
    this._mutationObserver.disconnect();
    this._mutationObserver.observe(this._root, {
      childList: true,
    });
    this._initializeRoot();
  }

  public setSelected(selectedIndex: number): void {
    const selectedChild: HTMLElement | undefined = this._children[selectedIndex];
    if (!selectedChild || selectedChild === this._selectedChild) {
      return;
    }
    this._selectedChild = selectedChild;

    this._resizeObserver.disconnect();
    this._resizeObserver.observe(selectedChild);

    this._debouncedSetHeight();
  }

  // Recalculate the height. This is necessary because ResizeObserver may not
  // fire if the height of the media is constrained by the host's own max-height
  // (e.g. during initial load, everything is 100% height of the host, so the
  // rendered height never changes and thus ResizeObserver never fires). This
  // manual "wakeup" allows the controller to temporarily lift the constraint
  // and peek at the true desired height.
  // See: https://github.com/dermotduffy/advanced-camera-card/issues/2109
  public recalculate(): void {
    this._debouncedSetHeight();
  }

  public destroy(): void {
    if (screenfull.isEnabled) {
      screenfull.off('change', this._fullscreenHandler);
    }
    document.removeEventListener('fullscreenchange', this._fullscreenHandler);
    document.removeEventListener('webkitfullscreenchange', this._fullscreenHandler);

    this._debouncedSetHeight.cancel();
    this._mutationObserver.disconnect();
    this._resizeObserver.disconnect();

    this._root = null;
    this._children = [];
    this._selectedChild = null;
  }

  private _isInFullscreen(): boolean {
    const fsElement =
      (screenfull.isEnabled ? screenfull.element : null) ??
      document.fullscreenElement ??
      (
        document as Document & {
          webkitFullscreenElement?: Element;
          webkitCurrentFullScreenElement?: Element;
        }
      ).webkitFullscreenElement ??
      (
        document as Document & {
          webkitFullscreenElement?: Element;
          webkitCurrentFullScreenElement?: Element;
        }
      ).webkitCurrentFullScreenElement;

    if (!fsElement) {
      return false;
    }

    let current: Node | null = this._host;
    while (current) {
      if (current === fsElement) {
        return true;
      }
      if (current instanceof ShadowRoot) {
        current = current.host;
      } else {
        current = current.parentNode;
      }
    }
    return false;
  }

  private _fullscreenHandler = (): void => {
    if (this._isInFullscreen()) {
      this._host.style.maxHeight = '';
    } else {
      this.recalculate();
    }
  };

  private _setHeight(): void {
    if (!this._selectedChild) {
      return;
    }

    if (this._isInFullscreen()) {
      this._host.style.maxHeight = '';
      return;
    }

    const originalHeight = this._host.style.maxHeight;

    // Remove the height restriction to ensure the full max height. Example of
    // behavior without this: Chrome on Android will not correctly size if the
    // card is in fullscreen mode.
    this._host.style.maxHeight = '';

    // Calculate the true height.
    const selectedHeight = this._selectedChild.getBoundingClientRect().height;

    // Reset the original height so that browser transition animation can be
    // applied from the current to the target.
    this._host.style.maxHeight = originalHeight;

    // Force the browser to reflow.
    this._selectedChild.getBoundingClientRect();

    if (selectedHeight && !isNaN(selectedHeight) && selectedHeight > 0) {
      this._host.style.maxHeight = `${selectedHeight}px`;
    }
  }

  private _initializeRoot(): void {
    /* v8 ignore next: the absent-root path cannot be reached as root will
    always exist by the time the mutation observer is observing -- @preserve */
    const children = [
      ...(this._root?.querySelectorAll<HTMLElement>(this._selector) ?? []),
    ];
    if (isEqual(children, this._children)) {
      return;
    }

    this._children = children;
    this._selectedChild = null;
  }
}
