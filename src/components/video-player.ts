import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
  public controlsOptions?: BuiltinControlsOptions | null;

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

  protected render(): TemplateResult | void {
    return html`
      <video
        ${ref(this._refVideo)}
        muted
        playsinline
        crossorigin="anonymous"
        ?autoplay=${this.autoplay}
        ?controls=${this.controls}
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
        }}"
        @volumechange=${() => dispatchMediaVolumeChangeEvent(this)}
        @play=${() => dispatchMediaPlayEvent(this)}
        @pause=${() => dispatchMediaPauseEvent(this)}
      >
        <source src="${ifDefined(this.url)}" type="video/mp4" />
      </video>
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
