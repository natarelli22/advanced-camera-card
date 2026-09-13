import { z } from 'zod';

import { advancedCameraCardCustomActionsBaseSchema } from './base';

export const miniTimelineActionConfigSchema =
  advancedCameraCardCustomActionsBaseSchema.extend({
    advanced_camera_card_action: z.literal('mini_timeline'),
    enabled: z.boolean().optional(),
  });
export type MiniTimelineActionConfig = z.infer<typeof miniTimelineActionConfigSchema>;
