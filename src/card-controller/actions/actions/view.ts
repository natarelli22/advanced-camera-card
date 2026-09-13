import type { ViewActionConfig } from '../../../config/schema/actions/custom/view';
import type { CardActionsAPI } from '../../types';
import { RemoveContextViewModifier } from '../../view/modifiers/remove-context';
import type { ViewModifier } from '../../view/types';
import { AdvancedCameraCardAction } from './base';

export class ViewAction extends AdvancedCameraCardAction<ViewActionConfig> {
  public async execute(api: CardActionsAPI): Promise<void> {
    await super.execute(api);

    const action = this._getAction();
    const targetView = action.advanced_camera_card_action;

    const modifiers: ViewModifier[] = [];
    if (targetView === 'live') {
      modifiers.push(new RemoveContextViewModifier(['miniTimeline']));
    }

    await api.getViewManager().setViewByParametersWithNewQuery({
      params: {
        view: targetView,
      },
      modifiers,
      ...(action.folder && {
        queryExecutorOptions: {
          folder: action.folder,
        },
      }),
    });
  }
}
