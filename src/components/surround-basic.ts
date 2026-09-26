import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import type { ViewManagerEpoch } from '../card-controller/view/types.js';
import type { ThumbnailsControlConfig } from '../config/schema/common/controls/thumbnails.js';
import surroundBasicStyle from '../scss/surround-basic.scss?inline';
import { contentsChanged } from '../utils/basic.js';

import './drawer.js';

import type { AdvancedCameraCardDrawer, DrawerIcons } from './drawer.js';

interface AdvancedCameraCardDrawerOpen {
  drawer: 'left' | 'right';
}

@customElement('advanced-camera-card-surround-basic')
export class AdvancedCameraCardSurroundBasic extends LitElement {
  @property({ attribute: false, hasChanged: contentsChanged })
  public drawerIcons?: {
    left?: DrawerIcons;
    right?: DrawerIcons;
  };

  @property({ attribute: false })
  public locked?: boolean;

  @property({ attribute: false })
  public thumbnailConfig?: ThumbnailsControlConfig;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  private _refDrawerLeft: Ref<AdvancedCameraCardDrawer> = createRef();
  private _refDrawerRight: Ref<AdvancedCameraCardDrawer> = createRef();
  private _refSlot: Ref<HTMLSlotElement> = createRef();
  private _boundDrawerHandler = this._drawerHandler.bind(this);
  private _resizeObserver?: ResizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this._updateDrawerButtonPosition())
      : undefined;
  private _observedMainElement?: Element;

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('advanced-camera-card:drawer:open', this._boundDrawerHandler);
    this.addEventListener('advanced-camera-card:drawer:close', this._boundDrawerHandler);
    this._resizeObserver?.observe(this);
  }

  disconnectedCallback(): void {
    this._resizeObserver?.disconnect();
    this._observedMainElement = undefined;
    this.removeEventListener(
      'advanced-camera-card:drawer:open',
      this._boundDrawerHandler,
    );
    this.removeEventListener(
      'advanced-camera-card:drawer:close',
      this._boundDrawerHandler,
    );
    super.disconnectedCallback();
  }

  protected firstUpdated(changedProps: PropertyValues): void {
    super.firstUpdated(changedProps);
    this._slotChanged();
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    this._updateDrawerButtonPosition();
    if (this.thumbnailConfig?.position === 'selected') {
      window.requestAnimationFrame?.(() => this._updateDrawerButtonPosition());
    }
  }

  private _getMainElement(): Element | null {
    return (
      this._refSlot.value?.assignedElements({ flatten: true })[0] ??
      Array.from(this.children).find((el) => !el.hasAttribute('slot')) ??
      null
    );
  }

  private _slotChanged(): void {
    const mainElement = this._getMainElement();
    if (mainElement !== this._observedMainElement) {
      if (this._observedMainElement) {
        this._resizeObserver?.unobserve(this._observedMainElement);
      }
      this._observedMainElement = mainElement ?? undefined;
      if (mainElement) {
        this._resizeObserver?.observe(mainElement);
      }
    }
    this._updateDrawerButtonPosition();
  }

  private _findSelectedElement(element: Element): Element | null {
    const root = element.shadowRoot ?? element;
    const selected = root.querySelector('[selected]');
    if (selected) {
      return selected;
    }
    for (const child of Array.from(root.children)) {
      const found = this._findSelectedElement(child);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private _updateDrawerButtonPosition(): void {
    const mainElement = this._observedMainElement ?? this._getMainElement();
    if (!mainElement) {
      this.style.removeProperty('--advanced-camera-card-drawer-button-top');
      return;
    }

    const hostRect = this.getBoundingClientRect();
    const mainRect = mainElement.getBoundingClientRect();
    if (!hostRect.height || !mainRect.height) {
      return;
    }

    const position = this.thumbnailConfig?.position ?? 'center';
    let center: number;

    if (position === 'selected') {
      const selectedElement = this._findSelectedElement(mainElement);
      const targetRect =
        selectedElement && selectedElement.getBoundingClientRect().height > 0
          ? selectedElement.getBoundingClientRect()
          : mainRect;
      center = targetRect.top - hostRect.top + targetRect.height / 2;
    } else if (position === 'top') {
      center = mainRect.top - hostRect.top + mainRect.height * 0.25;
    } else if (position === 'bottom') {
      center = mainRect.top - hostRect.top + mainRect.height * 0.75;
    } else if (typeof position === 'string' && position.trim().endsWith('%')) {
      const percent = parseFloat(position);
      center = !isNaN(percent)
        ? mainRect.top - hostRect.top + (mainRect.height * percent) / 100
        : mainRect.top - hostRect.top + mainRect.height / 2;
    } else if (
      typeof position === 'number' ||
      (typeof position === 'string' && /^\d+(\.\d+)?(px)?$/.test(position.trim()))
    ) {
      const pixels = parseFloat(String(position));
      center = !isNaN(pixels)
        ? mainRect.top - hostRect.top + pixels
        : mainRect.top - hostRect.top + mainRect.height / 2;
    } else {
      center = mainRect.top - hostRect.top + mainRect.height / 2;
    }

    this.style.setProperty(
      '--advanced-camera-card-drawer-button-top',
      `${Math.round(center)}px`,
    );
  }

  private _drawerHandler(ev: Event) {
    const drawer = (ev as CustomEvent<AdvancedCameraCardDrawerOpen>).detail.drawer;
    const open = ev.type.endsWith(':open');
    if (drawer === 'left' && this._refDrawerLeft.value) {
      this._refDrawerLeft.value.open = open;
    } else if (drawer === 'right' && this._refDrawerRight.value) {
      this._refDrawerRight.value.open = open;
    }
  }

  protected render(): TemplateResult | void {
    return html` <slot name="above"></slot>
      <slot ${ref(this._refSlot)} @slotchange=${() => this._slotChanged()}></slot>
      <advanced-camera-card-drawer
        ${ref(this._refDrawerLeft)}
        location="left"
        .icons=${this.drawerIcons?.left}
        .locked=${this.locked}
      >
        <slot name="left"></slot>
      </advanced-camera-card-drawer>
      <advanced-camera-card-drawer
        ${ref(this._refDrawerRight)}
        location="right"
        .icons=${this.drawerIcons?.right}
        .locked=${this.locked}
      >
        <slot name="right"></slot>
      </advanced-camera-card-drawer>
      <slot name="below"></slot>`;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(surroundBasicStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-surround-basic': AdvancedCameraCardSurroundBasic;
  }
}
