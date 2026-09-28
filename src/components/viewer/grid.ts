import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import type { CameraManager } from '../../camera-manager/manager.js';
import type { ViewItemManager } from '../../card-controller/view/item-manager.js';
import type { ViewManagerEpoch } from '../../card-controller/view/types.js';
import type { MediaGridSelected } from '../../components-lib/media-grid-controller.js';
import type { CardWideConfig } from '../../config/schema/types.js';
import type { ViewerConfig } from '../../config/schema/viewer.js';
import type { ResolvedMediaCache } from '../../ha/resolved-media.js';
import type { HomeAssistant } from '../../ha/types.js';
import { getViewerGridCameraIDs } from '../../view/layout.js';
import { ViewItemClassifier } from '../../view/item-classifier.js';

import '../../patches/ha-hls-player.js';

import basicBlockStyle from '../../scss/basic-block.scss?inline';

import './carousel.js';

import type { AdvancedCameraCardViewerCarousel } from './carousel.js';

interface SuppressedSync {
  playUntil?: number;
  pauseUntil?: number;
  seekedUntil?: number;
}

@customElement('advanced-camera-card-viewer-grid')
export class AdvancedCameraCardViewerGrid extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  @property({ attribute: false })
  public viewerConfig?: ViewerConfig;

  @property({ attribute: false })
  public resolvedMediaCache?: ResolvedMediaCache;

  @property({ attribute: false })
  public cardWideConfig?: CardWideConfig;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  @property({ attribute: false })
  public viewItemManager?: ViewItemManager;

  private _shouldShowControls(filterCamera?: string): boolean {
    if (!filterCamera) {
      return true;
    }
    const view = this.viewManagerEpoch?.manager.getView();
    const queryResults = view?.queryResults;
    const rawSelected = view?.camera;
    const selectedCameraID = rawSelected?.replace(/^camera\//, '');
    const normalizedFilterCamera = filterCamera.replace(/^camera\//, '');

    const isRecording = (item?: unknown): boolean => {
      const media = item as ViewMedia | null;
      return (
        !!media &&
        (ViewItemClassifier.isRecording(media) || media.getMediaType?.() === 'recording')
      );
    };

    const isEvent = (item?: unknown): boolean => {
      const media = item as ViewMedia | null;
      return (
        !!media &&
        (ViewItemClassifier.isEvent(media) ||
          media.getMediaType?.() === 'clip' ||
          media.getMediaType?.() === 'snapshot')
      );
    };

    const thisMedia = queryResults?.getSelectedResult(filterCamera);
    const isThisRecording = isRecording(thisMedia);

    // Verify if any camera in the grid is displaying an event
    const gridCameraIDs = this._getGridCameraIDs();
    let hasAnyEvent = false;
    let eventCameraID: string | null = null;
    if (gridCameraIDs && queryResults) {
      for (const camID of gridCameraIDs) {
        const media = queryResults.getSelectedResult(camID);
        if (isEvent(media)) {
          hasAnyEvent = true;
          const normalizedCamID = camID.replace(/^camera\//, '');
          if (!eventCameraID || normalizedCamID === selectedCameraID) {
            eventCameraID = normalizedCamID;
          }
        }
      }
    }

    if (hasAnyEvent) {
      // Continuous recordings NEVER show controls if there is an event in the grid!
      if (isThisRecording) {
        return false;
      }
      return normalizedFilterCamera === eventCameraID;
    }

    return selectedCameraID === normalizedFilterCamera;
  }

  private _renderCarousel(filterCamera?: string): TemplateResult {
    // Get the camera's grid width factor from its dimensions config.
    const gridWidthFactor = filterCamera
      ? this.cameraManager?.getStore().getCameraConfig(filterCamera)?.dimensions?.grid
          ?.width_factor
      : undefined;

    return html`
      <advanced-camera-card-viewer-carousel
        grid-id=${ifDefined(filterCamera)}
        grid-width-factor=${ifDefined(gridWidthFactor)}
        .hass=${this.hass}
        .viewManagerEpoch=${this.viewManagerEpoch}
        .viewFilterCameraID=${filterCamera}
        .autoHeight=${!filterCamera}
        .viewerConfig=${this.viewerConfig}
        .resolvedMediaCache=${this.resolvedMediaCache}
        .cameraManager=${this.cameraManager}
        .cardWideConfig=${this.cardWideConfig}
        .showControls=${this._shouldShowControls(filterCamera)}
        .viewItemManager=${this.viewItemManager}
      >
      </advanced-camera-card-viewer-carousel>
    `;
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (
      (changedProps.has('viewManagerEpoch') || changedProps.has('cameraManager')) &&
      this._getGridCameraIDs()
    ) {
      void import('../media-grid.js');
    }
  }

  private _getGridCameraIDs(): Set<string> | null {
    const view = this.viewManagerEpoch?.manager.getView();
    return view ? getViewerGridCameraIDs(view, this.cameraManager) : null;
  }

  private _gridSelectCamera(cameraID: string): void {
    const view = this.viewManagerEpoch?.manager.getView();
    this.viewManagerEpoch?.manager.setViewByParameters({
      params: {
        camera: cameraID,
        queryResults: view?.queryResults
          ?.clone()
          .promoteCameraSelectionToMainSelection(cameraID),
      },
    });
  }

  private _isSyncing = false;
  private _suppressedSync = new WeakMap<
    AdvancedCameraCardViewerCarousel,
    SuppressedSync
  >();

  private _suppressSync(
    carousel: AdvancedCameraCardViewerCarousel,
    type: 'play' | 'pause' | 'seeked',
    durationMs = 600,
  ): void {
    const current = this._suppressedSync.get(carousel) ?? {};
    const until = Date.now() + durationMs;
    if (type === 'play') current.playUntil = until;
    else if (type === 'pause') current.pauseUntil = until;
    else if (type === 'seeked') current.seekedUntil = until;
    this._suppressedSync.set(carousel, current);
  }

  private _isSyncSuppressed(
    carousel: AdvancedCameraCardViewerCarousel,
    type: 'play' | 'pause' | 'seeked',
  ): boolean {
    const current = this._suppressedSync.get(carousel);
    if (!current) {
      return false;
    }
    const now = Date.now();
    let until: number | undefined;
    if (type === 'play') {
      until = current.playUntil;
      current.playUntil = undefined;
    } else if (type === 'pause') {
      until = current.pauseUntil;
      current.pauseUntil = undefined;
    } else if (type === 'seeked') {
      until = current.seekedUntil;
      current.seekedUntil = undefined;
    }
    return typeof until === 'number' && now < until;
  }

  private _handleMediaEnded(ev: Event): void {
    if (this.viewerConfig?.grid?.sync_playback === false) {
      return;
    }
    const originCarousel = (ev.target as HTMLElement).closest(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel | null;
    if (!originCarousel) {
      return;
    }

    const originMedia = originCarousel.getSelectedMedia();
    const originStartTime = originMedia?.getStartTime();

    const carousels = this.renderRoot.querySelectorAll<AdvancedCameraCardViewerCarousel>(
      'advanced-camera-card-viewer-carousel',
    );
    for (const carousel of carousels) {
      this._suppressSync(carousel, 'pause', 600);
      void carousel.pause();
      if (carousel !== originCarousel && originStartTime) {
        const otherMedia = carousel.getSelectedMedia();
        const otherStartTime = otherMedia?.getStartTime();
        if (otherMedia && otherStartTime && otherMedia.includesTime(originStartTime)) {
          const offsetSec = (originStartTime.getTime() - otherStartTime.getTime()) / 1000;
          this._suppressSync(carousel, 'seeked', 600);
          void carousel.seek(offsetSec);
        }
      } else if (carousel === originCarousel) {
        this._suppressSync(carousel, 'seeked', 600);
        void carousel.seek(0);
      }
    }
  }

  private async _handleMediaPlay(ev: CustomEvent<{ currentTime?: number }>): Promise<void> {
    if (this._isSyncing || this.viewerConfig?.grid?.sync_playback === false) {
      return;
    }
    const originCarousel = (ev.target as HTMLElement).closest(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel | null;
    if (!originCarousel || this._isSyncSuppressed(originCarousel, 'play')) {
      return;
    }

    const currentTime = ev.detail?.currentTime;
    const originMedia = originCarousel.getSelectedMedia();
    const originStartTime = originMedia?.getStartTime();

    this._isSyncing = true;
    try {
      const carousels =
        this.renderRoot.querySelectorAll<AdvancedCameraCardViewerCarousel>(
          'advanced-camera-card-viewer-carousel',
        );
      for (const carousel of carousels) {
        if (carousel !== originCarousel) {
          if (typeof currentTime === 'number' && originStartTime) {
            const targetRealTime = new Date(originStartTime.getTime() + currentTime * 1000);
            const otherMedia = carousel.getSelectedMedia();
            const otherStartTime = otherMedia?.getStartTime();
            if (otherMedia && otherStartTime && otherMedia.includesTime(targetRealTime)) {
              const offsetSec =
                (targetRealTime.getTime() - otherStartTime.getTime()) / 1000;
              this._suppressSync(carousel, 'seeked', 600);
              await carousel.seek(offsetSec);
            }
          }
          this._suppressSync(carousel, 'play', 600);
          void carousel.play();
        }
      }
    } finally {
      this._isSyncing = false;
    }
  }

  private _handleMediaPause(ev: Event): void {
    if (this._isSyncing || this.viewerConfig?.grid?.sync_playback === false) {
      return;
    }
    const originCarousel = (ev.target as HTMLElement).closest(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel | null;
    if (!originCarousel || this._isSyncSuppressed(originCarousel, 'pause')) {
      return;
    }

    this._isSyncing = true;
    try {
      const carousels =
        this.renderRoot.querySelectorAll<AdvancedCameraCardViewerCarousel>(
          'advanced-camera-card-viewer-carousel',
        );
      for (const carousel of carousels) {
        if (carousel !== originCarousel) {
          this._suppressSync(carousel, 'pause', 600);
          void carousel.pause();
        }
      }
    } finally {
      this._isSyncing = false;
    }
  }

  private _handleMediaSeeked(ev: CustomEvent<{ currentTime?: number }>): void {
    if (this._isSyncing || this.viewerConfig?.grid?.sync_playback === false) {
      return;
    }
    const originCarousel = (ev.target as HTMLElement).closest(
      'advanced-camera-card-viewer-carousel',
    ) as AdvancedCameraCardViewerCarousel | null;
    if (!originCarousel || this._isSyncSuppressed(originCarousel, 'seeked')) {
      return;
    }

    const currentTime = ev.detail?.currentTime;
    const originMedia = originCarousel.getSelectedMedia();
    const originStartTime = originMedia?.getStartTime();
    if (typeof currentTime !== 'number' || !originStartTime) {
      return;
    }

    const targetRealTime = new Date(originStartTime.getTime() + currentTime * 1000);
    this._isSyncing = true;
    try {
      const carousels =
        this.renderRoot.querySelectorAll<AdvancedCameraCardViewerCarousel>(
          'advanced-camera-card-viewer-carousel',
        );
      for (const carousel of carousels) {
        if (carousel !== originCarousel) {
          const otherMedia = carousel.getSelectedMedia();
          const otherStartTime = otherMedia?.getStartTime();
          if (otherMedia && otherStartTime && otherMedia.includesTime(targetRealTime)) {
            const offsetSec =
              (targetRealTime.getTime() - otherStartTime.getTime()) / 1000;
            this._suppressSync(carousel, 'seeked', 600);
            void carousel.seek(offsetSec);
          }
        }
      }
    } finally {
      this._isSyncing = false;
    }
  }

  protected render(): TemplateResult {
    const cameraIDs = this._getGridCameraIDs();
    if (!cameraIDs) {
      return this._renderCarousel();
    }

    return html`
      <advanced-camera-card-media-grid
        .selected=${this.viewManagerEpoch?.manager.getView()?.camera}
        .displayConfig=${this.viewerConfig?.display}
        @advanced-camera-card:media-grid:selected=${(
          ev: CustomEvent<MediaGridSelected>,
        ) => this._gridSelectCamera(ev.detail.selected)}
        @advanced-camera-card:media:ended=${(ev: Event) => this._handleMediaEnded(ev)}
        @advanced-camera-card:media:play=${(
          ev: CustomEvent<{ currentTime?: number }>,
        ) => this._handleMediaPlay(ev)}
        @advanced-camera-card:media:pause=${(ev: Event) => this._handleMediaPause(ev)}
        @advanced-camera-card:media:seeked=${(
          ev: CustomEvent<{ currentTime?: number }>,
        ) => this._handleMediaSeeked(ev)}
      >
        ${[...cameraIDs].map((cameraID) => this._renderCarousel(cameraID))}
      </advanced-camera-card-media-grid>
    `;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(basicBlockStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-viewer-grid': AdvancedCameraCardViewerGrid;
  }
}
