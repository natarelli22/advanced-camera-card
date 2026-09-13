import type { ActionsExecutor } from '../../card-controller/actions/types';
import type { PTZAction, PTZActionPhase } from '../../config/schema/actions/custom/ptz';
import type { Entity, EntityRegistryManager } from '../../ha/registry/entity/types';
import type { HomeAssistant } from '../../ha/types';
import {
  PTZMovementType,
  type CapabilitiesRaw,
  type Endpoint,
  type PTZCapabilities,
} from '../../types';
import type { CameraInitializationOptions } from '../camera';
import { EntityCamera } from '../entity-camera';
import type { CameraEndpointsContext, CameraProxyConfig } from '../types';
import { getPTZCapabilitiesFromCameraConfig, mergePTZCapabilities } from '../utils/ptz';

interface TPLinkCameraInitializationOptions extends CameraInitializationOptions {
  entityRegistryManager: EntityRegistryManager;
}

interface PTZEntities {
  left?: string;
  right?: string;
  up?: string;
  down?: string;
}
type PTZEntity = keyof PTZEntities;

export class TPLinkCamera extends EntityCamera<TPLinkCameraInitializationOptions> {
  private _ptzEntities: PTZEntities | null = null;
  private _mediaSyncEntityID: string | null = null;

  public override getProxyConfig(): CameraProxyConfig {
    return {
      ...super.getProxyConfig(),
      media: this._config.proxy.media === 'auto' ? true : this._config.proxy.media,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected override _getUIEndpoint(_context?: CameraEndpointsContext): Endpoint | null {
    return this._config.tplink?.url ? { endpoint: this._config.tplink.url } : null;
  }

  protected async _initializeBeforeCapabilities(
    hass: HomeAssistant,
    options: TPLinkCameraInitializationOptions,
  ): Promise<void> {
    await super._initializeBeforeCapabilities(hass, options);
    this._ptzEntities = await this._getPTZEntities(hass, options.entityRegistryManager);
    this._mediaSyncEntityID = await this._getMediaSyncEntityID(
      hass,
      options.entityRegistryManager,
    );
  }

  public getStoragePath(hass?: HomeAssistant): string | null {
    if (!hass) {
      return null;
    }

    const cameraEntityID = this._entity?.entity_id ?? this.getConfig().camera_entity;

    // 1. Check camera entity attributes directly
    if (cameraEntityID && hass.states[cameraEntityID]?.attributes?.storage_path) {
      const p = hass.states[cameraEntityID].attributes.storage_path;
      if (typeof p === 'string' && p.trim().length > 0) {
        return p.trim();
      }
    }

    // 2. Check media sync switch on the same device
    if (
      this._mediaSyncEntityID &&
      hass.states[this._mediaSyncEntityID]?.attributes?.storage_path
    ) {
      const p = hass.states[this._mediaSyncEntityID].attributes.storage_path;
      if (typeof p === 'string' && p.trim().length > 0) {
        return p.trim();
      }
    }

    // 3. Match any switch entity with storage_path matching camera in hass.states
    for (const [entityId, stateObj] of Object.entries(hass.states)) {
      if (
        entityId.startsWith('switch.') &&
        stateObj.attributes?.storage_path &&
        typeof stateObj.attributes.storage_path === 'string'
      ) {
        const cameraCore = (cameraEntityID ?? this.getID())
          .replace(/^camera\./, '')
          .replace(/(_hd_stream|_sd_stream|_stream|_hd|_sd)$/, '')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase();
        const switchCore = entityId
          .replace(/^switch\./, '')
          .replace(/_media_sync$/, '')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase();
        if (
          cameraCore &&
          switchCore &&
          (cameraCore === switchCore ||
            cameraCore.includes(switchCore) ||
            switchCore.includes(cameraCore))
        ) {
          return stateObj.attributes.storage_path.trim();
        }
      }
    }

    return null;
  }

  private async _getMediaSyncEntityID(
    hass: HomeAssistant,
    entityRegistry: EntityRegistryManager,
  ): Promise<string | null> {
    if (!this._entity?.device_id) {
      return null;
    }

    const syncEntities = await entityRegistry.getMatchingEntities(
      hass,
      (ent: Entity) =>
        ent.device_id === this._entity?.device_id &&
        ent.entity_id.startsWith('switch.') &&
        ent.entity_id.endsWith('_media_sync') &&
        !ent.disabled_by,
    );

    return syncEntities.length ? syncEntities[0].entity_id : null;
  }

  protected async _getRawCapabilities(
    hass: HomeAssistant,
    options: TPLinkCameraInitializationOptions,
  ): Promise<CapabilitiesRaw> {
    const configPTZ = getPTZCapabilitiesFromCameraConfig(this.getConfig());
    const tplinkPTZ = this._ptzEntities
      ? this._entitiesToCapabilities(this._ptzEntities)
      : null;

    const combinedPTZ = mergePTZCapabilities(tplinkPTZ, configPTZ);

    return {
      ...(await super._getRawCapabilities(hass, options)),
      clips: true,
      recordings: true,
      ...(combinedPTZ && { ptz: combinedPTZ }),
    };
  }

  private async _getPTZEntities(
    hass: HomeAssistant,
    entityRegistry: EntityRegistryManager,
  ): Promise<PTZEntities | null> {
    if (!this._entity?.device_id) {
      return null;
    }

    // Find all button entities on the same device
    const buttonEntities = await entityRegistry.getMatchingEntities(
      hass,
      (ent: Entity) =>
        ent.device_id === this._entity?.device_id &&
        ent.entity_id.startsWith('button.') &&
        !ent.disabled_by,
    );

    // TPLink uses pan_right, pan_left, tilt_up, tilt_down button entity suffixes
    const entitySuffixToAction: Record<string, PTZEntity> = {
      pan_left: 'left',
      pan_right: 'right',
      tilt_up: 'up',
      tilt_down: 'down',
    };

    const ptzEntities: PTZEntities = {};
    for (const buttonEntity of buttonEntities) {
      for (const [suffix, action] of Object.entries(entitySuffixToAction)) {
        if (buttonEntity.entity_id.endsWith(`_${suffix}`)) {
          ptzEntities[action] = buttonEntity.entity_id;
        }
      }
    }

    return Object.keys(ptzEntities).length ? ptzEntities : null;
  }

  private _entitiesToCapabilities(ptzEntities: PTZEntities): PTZCapabilities {
    const tplinkPTZCapabilities: PTZCapabilities = {};
    // TPLink buttons perform relative movements (no stop button needed)
    for (const key of Object.keys(ptzEntities) as PTZEntity[]) {
      tplinkPTZCapabilities[key] = [PTZMovementType.Relative];
    }
    return tplinkPTZCapabilities;
  }

  public async executePTZAction(
    executor: ActionsExecutor,
    action: PTZAction,
    options?: {
      hass?: HomeAssistant;
      phase?: PTZActionPhase;
      preset?: string;
    },
  ): Promise<boolean> {
    if (await super.executePTZAction(executor, action, options)) {
      return true;
    }

    if (!this._ptzEntities) {
      return false;
    }

    // TPLink doesn't support presets
    if (action === 'preset') {
      return false;
    }

    // TPLink doesn't have zoom capabilities
    if (action === 'zoom_in' || action === 'zoom_out') {
      return false;
    }

    // TPLink doesn't have a stop button - the camera stops when the button
    // press action completes. We return true to indicate the stop was "handled"
    // (even though no action is actually taken).
    if (options?.phase === 'stop') {
      return true;
    }

    const entityID = this._ptzEntities[action];
    if (!entityID) {
      return false;
    }

    await executor.executeActions({
      actions: [
        {
          action: 'perform-action',
          perform_action: 'button.press',
          target: { entity_id: entityID },
        },
      ],
    });
    return true;
  }
}
