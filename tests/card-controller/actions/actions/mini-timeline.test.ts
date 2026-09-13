import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { MiniTimelineAction } from '../../../../src/card-controller/actions/actions/mini-timeline';
import type { View } from '../../../../src/view/view';
import { createCardAPI } from '../../../test-utils';

describe('MiniTimelineAction', () => {
  it('should set enabled explicitly', async () => {
    const api = createCardAPI();
    const action = new MiniTimelineAction(
      {},
      {
        action: 'fire-dom-event',
        advanced_camera_card_action: 'mini_timeline',
        enabled: true,
      },
    );

    await action.execute(api);

    expect(api.getViewManager().setViewWithMergedContext).toHaveBeenCalledWith({
      miniTimeline: { enabled: true },
    });
  });

  it('should toggle enabled when not specified', async () => {
    const api = createCardAPI();
    const view = mock<View>();
    view.context = { miniTimeline: { enabled: true } };
    vi.mocked(api.getViewManager().getView).mockReturnValue(view);

    const action = new MiniTimelineAction(
      {},
      {
        action: 'fire-dom-event',
        advanced_camera_card_action: 'mini_timeline',
      },
    );

    await action.execute(api);

    expect(api.getViewManager().setViewWithMergedContext).toHaveBeenCalledWith({
      miniTimeline: { enabled: false },
    });
  });

  it('should query on live view if query is absent when toggling on', async () => {
    const api = createCardAPI();
    const view = mock<View>();
    view.is.mockImplementation((name) => name === 'live');
    view.query = null;
    vi.mocked(api.getViewManager().getView).mockReturnValue(view);

    const action = new MiniTimelineAction(
      {},
      {
        action: 'fire-dom-event',
        advanced_camera_card_action: 'mini_timeline',
        enabled: true,
      },
    );

    await action.execute(api);

    expect(api.getViewManager().setViewByParametersWithNewQuery).toHaveBeenCalled();
  });
});

