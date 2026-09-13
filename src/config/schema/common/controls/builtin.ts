import { z } from 'zod';

export const builtinControlsOptionsDefault = {
  play_pause: true,
  progress: true,
  volume: true,
  fullscreen: true,
} as const;

export const builtinControlsOptionsSchema = z.object({
  play_pause: z.boolean().default(builtinControlsOptionsDefault.play_pause),
  progress: z.boolean().default(builtinControlsOptionsDefault.progress),
  volume: z.boolean().default(builtinControlsOptionsDefault.volume),
  fullscreen: z.boolean().default(builtinControlsOptionsDefault.fullscreen),
});
export type BuiltinControlsOptions = z.infer<typeof builtinControlsOptionsSchema>;

export const builtinControlsSchema = z.union([
  z.boolean(),
  builtinControlsOptionsSchema,
]);
export type BuiltinControls = z.infer<typeof builtinControlsSchema>;

export const resolveBuiltinControls = (
  builtin?: BuiltinControls,
): BuiltinControlsOptions | null => {
  if (builtin === false) {
    return null;
  }
  if (builtin === true || builtin === undefined) {
    return { ...builtinControlsOptionsDefault };
  }
  return {
    play_pause: builtin.play_pause ?? builtinControlsOptionsDefault.play_pause,
    progress: builtin.progress ?? builtinControlsOptionsDefault.progress,
    volume: builtin.volume ?? builtinControlsOptionsDefault.volume,
    fullscreen: builtin.fullscreen ?? builtinControlsOptionsDefault.fullscreen,
  };
};
