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

import type { TransitionEffect } from '../config/schema/common/transition-effect';
import carouselStyle from '../scss/carousel.scss?inline';
import {
  CarouselController,
  type CarouselDirection,
  type EmblaCarouselPlugins,
} from '../utils/embla/carousel-controller';
import { getTextDirection } from '../utils/text-direction';

@customElement('advanced-camera-card-carousel')
export class AdvancedCameraCardCarousel extends LitElement {
  @property({ attribute: true, reflect: true })
  public direction: CarouselDirection = 'horizontal';

  @property({ attribute: true })
  public transitionEffect?: TransitionEffect;

  @property({ attribute: false })
  public loop?: boolean;

  @property({ attribute: false })
  public dragFree?: boolean;

  @property({ attribute: false })
  public dragEnabled = true;

  @property({ attribute: false })
  public plugins?: EmblaCarouselPlugins;

  @property({ attribute: false })
  public wheelScrolling?: boolean;

  @property({ attribute: false })
  public selected = 0;

  private _refParent: Ref<HTMLSlotElement> = createRef();
  private _refRoot: Ref<HTMLElement> = createRef();
  private _carousel: CarouselController | null = null;


  connectedCallback(): void {
    super.connectedCallback();

    // Guarantee recreation of carousel if the component is reconnected.
    this.requestUpdate();
  }

  disconnectedCallback(): void {
    // Destroy the carousel when the component is disconnected, which forces the
    // plugins (which may have registered event handlers) to also be destroyed.
    // The carousel will automatically reconstruct if the component is re-rendered.
    this._carousel?.destroy();
    this._carousel = null;
    super.disconnectedCallback();
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has('direction')) {
      this.setAttribute('direction', this.direction);
    }

    const destroyProperties = [
      'direction',
      'dragFree',
      'loop',
      'plugins',
      'transitionEffect',
    ] as const;
    if (destroyProperties.some((prop) => changedProps.has(prop))) {
      this._carousel?.destroy();
      this._carousel = null;
    } else if (changedProps.has('dragEnabled') && this._carousel) {
      this._carousel.setDragEnabled(this.dragEnabled);
    }
  }

  protected render(): TemplateResult | void {
    return html` <div class="embla">
      <slot name="left"></slot>
      <div ${ref(this._refRoot)} class="embla__viewport">
        <div class="embla__container">
          <slot ${ref(this._refParent)}></slot>
        </div>
      </div>
      <slot name="right"></slot>
    </div>`;
  }

  protected updated(changedProps: PropertyValues): void {
    if (
      !this._carousel &&
      this._refRoot.value &&
      this._refParent.value &&
      // Never construct a carousel if the node is not connected. There can be a
      // race condition between the Lit update lifecycle, and the
      // disconnect/connect callbacks, causing a carousel to potentially be
      // created after the node is disconnected. This could cause a dangling
      // carousel and hold open connections that should have been closed.
      // See: https://github.com/dermotduffy/advanced-camera-card/issues/1992
      this.isConnected
    ) {
      this._carousel = new CarouselController(
        this._refRoot.value,
        this._refParent.value,
        {
          direction: this.direction,
          dragEnabled: this.dragEnabled,
          dragFree: this.dragFree,
          startIndex: this.selected,
          transitionEffect: this.transitionEffect,
          loop: this.loop,
          plugins: this.plugins,
          textDirection: getTextDirection(this),
          wheelScrolling: this.wheelScrolling,
        },
      );
    } else if (this._carousel) {
      if (
        changedProps.has('selected') &&
        this.selected !== null &&
        this.selected !== undefined &&
        this.selected >= 0 &&
        !this._carousel.isSlideInCurrentSnap(this.selected)
      ) {
        this._carousel.selectSlide(this.selected);
      }
    }
  }

  public isDragging(): boolean {
    return this._carousel?.isDragging() ?? false;
  }

  public scrollToSelected(jump = false): void {
    if (!this._carousel) {
      return;
    }
    this._carousel.reInit();
    if (this.selected !== null && this.selected !== undefined && this.selected >= 0) {
      this._carousel.selectSlide(this.selected, jump);
    }
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(carouselStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-carousel': AdvancedCameraCardCarousel;
  }
}
