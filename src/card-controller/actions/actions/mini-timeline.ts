import type { MiniTimelineActionConfig } from '../../../config/schema/actions/custom/mini-timeline';
import type { CardActionsAPI } from '../../types';
import { MergeContextViewModifier } from '../../view/modifiers/merge-context';
import { AdvancedCameraCardAction } from './base';

export class MiniTimelineAction extends AdvancedCameraCardAction<MiniTimelineActionConfig> {
  public async execute(api: CardActionsAPI): Promise<void> {
    await super.execute(api);

    const action = this._getAction();
    const view = api.getViewManager().getView();
    const currentEnabled = view?.context?.miniTimeline?.enabled;

    const isLive = view?.is('live');
    const config = api.getConfigManager().getConfig();
    const liveTimelineConfig = config?.live.controls.timeline;
    const viewerTimelineConfig = config?.media_viewer.controls.timeline;
    const isConfigHidden = isLive
      ? liveTimelineConfig?.mode === 'none' || !!liveTimelineConfig?.hidden_by_default
      : !!viewerTimelineConfig?.hidden_by_default;

    const isOn = currentEnabled !== undefined ? currentEnabled : !isConfigHidden;
    const enabled = action.enabled ?? !isOn;

    if (
      enabled &&
      isLive &&
      typeof view?.queryResults?.resetSelectedResult === 'function'
    ) {
      view.queryResults.resetSelectedResult();
      for (const cameraID of view.queryResults.getCameraIDs?.() ?? []) {
        view.queryResults.resetSelectedResult(cameraID);
      }
    }

    if (enabled && !view?.query && isLive) {
      await api.getViewManager().setViewByParametersWithNewQuery({
        modifiers: [new MergeContextViewModifier({ miniTimeline: { enabled } })],
      });
    } else {
      api.getViewManager().setViewWithMergedContext({
        miniTimeline: { enabled },
      });
    }
  }
}
