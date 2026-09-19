import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import { MediaLoadedInfoSourceController } from '../components-lib/media-loaded-info-source-controller.js';
import { VideoMediaPlayerController } from '../components-lib/media-player/video.js';
import type { BuiltinControlsOptions } from '../config/schema/common/controls/builtin.js';
import videoPlayerStyle from '../scss/video-player.scss?inline';
import type { MediaPlayer, MediaPlayerController, MediaPlayerElement } from '../types';
import { mayHaveAudio } from '../utils/audio';
import {
  hideMediaControlsTemporarily,
  MEDIA_LOAD_CONTROLS_HIDE_SECONDS,
  setControlsOnVideo,
} from '../utils/controls';
import {
  createMediaLoadedInfo,
  dispatchMediaPauseEvent,
  dispatchMediaPlayEvent,
  dispatchMediaVolumeChangeEvent,
} from '../utils/media-info';

@customElement('advanced-camera-card-video-player')
export class AdvancedCameraCardVideoPlayer extends LitElement implements MediaPlayer {
  @property()
  public url?: string;

  @property()
  public targetID?: string;

  @property({ type: Boolean })
  public autoplay = false;

  @property({ type: Boolean })
  public controls = false;

  @property({ attribute: false })
  public poster?: string;

  @property({ attribute: false })
  public controlsOptions?: BuiltinControlsOptions | null;

  @state()
  private _isPlaying = false;

  private _refVideo: Ref<MediaPlayerElement<HTMLVideoElement>> = createRef();
  private _mediaPlayerController = new VideoMediaPlayerController(
    this,
    () => this._refVideo.value ?? null,
    () => this.controls,
  );

  private _mediaLoadedInfoSourceController = new MediaLoadedInfoSourceController(this, {
    getTargetID: () => this.targetID ?? null,
  });

  public async getMediaPlayerController(): Promise<MediaPlayerController | null> {
    return this._mediaPlayerController;
  }

  protected updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);
    if (changedProperties.has('url') && this._refVideo.value) {
      setControlsOnVideo(this._refVideo.value, false);
    }
    if ((changedProperties.has('url') || changedProperties.has('poster')) && this.poster) {
      this._isPlaying = false;
    }
    if (changedProperties.has('controls') && this._refVideo.value) {
      if (!this.controls) {
        setControlsOnVideo(this._refVideo.value, false);
      } else if (this._refVideo.value.readyState >= HTMLMediaElement.HAVE_METADATA) {
        setControlsOnVideo(this._refVideo.value, true);
      }
    }
    if (
      this.autoplay &&
      (changedProperties.has('autoplay') || changedProperties.has('url'))
    ) {
      void this._mediaPlayerController.playback.play();
    }
  }

  protected render(): TemplateResult | void {
    return html`
      <video
        ${ref(this._refVideo)}
        muted
        playsinline
        crossorigin="anonymous"
        .poster=${this.poster ?? ''}
        ?autoplay=${this.autoplay}
        controlsList=${ifDefined(
          this.controlsOptions?.fullscreen === false ? 'nofullscreen' : undefined,
        )}
        class=${classMap({
          'no-fullscreen': this.controlsOptions?.fullscreen === false,
          'no-volume': this.controlsOptions?.volume === false,
          'no-play-pause': this.controlsOptions?.play_pause === false,
          'no-progress': this.controlsOptions?.progress === false,
        })}
        @loadedmetadata=${(ev: Event) => {
          if (ev.target && this.controls) {
            hideMediaControlsTemporarily(
              ev.target as HTMLVideoElement,
              MEDIA_LOAD_CONTROLS_HIDE_SECONDS,
              true,
            );
          }
        }}
        @loadeddata="${(ev: Event) => {
          const info = createMediaLoadedInfo(ev, {
            ...(this._mediaPlayerController && {
              mediaPlayerController: this._mediaPlayerController,
            }),
            capabilities: {
              supportsPause: true,
              hasAudio: mayHaveAudio(ev.target as HTMLVideoElement),
            },
            technology: ['mp4'],
          });
          if (info) {
            this._mediaLoadedInfoSourceController.set(info);
          }
          if (this.autoplay) {
            void this._mediaPlayerController.playback.play();
          }
        }}"
        @volumechange=${() => dispatchMediaVolumeChangeEvent(this)}
        @playing=${() => {
          this._isPlaying = true;
        }}
        @play=${() => dispatchMediaPlayEvent(this)}
        @pause=${() => dispatchMediaPauseEvent(this)}
      >
        <source src="${ifDefined(this.url)}" type="video/mp4" />
      </video>
      ${this.poster && !this._isPlaying
        ? html`<img class="poster" src="${this.poster}" aria-hidden="true" />`
        : ''}
    `;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(videoPlayerStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-video-player': AdvancedCameraCardVideoPlayer;
  }
}
