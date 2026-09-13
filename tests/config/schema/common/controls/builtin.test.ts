import { describe, expect, it } from 'vitest';

import {
  builtinControlsOptionsDefault,
  builtinControlsOptionsSchema,
  builtinControlsSchema,
  resolveBuiltinControls,
} from '../../../../../src/config/schema/common/controls/builtin';
import { liveConfigSchema } from '../../../../../src/config/schema/live';
import { viewerConfigSchema } from '../../../../../src/config/schema/viewer';

describe('builtin controls schema', () => {
  describe('builtinControlsOptionsSchema', () => {
    it('should parse empty object with all defaults true', () => {
      expect(builtinControlsOptionsSchema.parse({})).toEqual({
        play_pause: true,
        progress: true,
        volume: true,
        fullscreen: true,
      });
    });

    it('should parse custom options', () => {
      expect(
        builtinControlsOptionsSchema.parse({
          play_pause: true,
          progress: true,
          volume: false,
          fullscreen: false,
        }),
      ).toEqual({
        play_pause: true,
        progress: true,
        volume: false,
        fullscreen: false,
      });
    });

    it('should parse partial options with remaining defaulted to true', () => {
      expect(
        builtinControlsOptionsSchema.parse({
          volume: false,
        }),
      ).toEqual({
        play_pause: true,
        progress: true,
        volume: false,
        fullscreen: true,
      });
    });

    it('should reject invalid option values', () => {
      expect(() =>
        builtinControlsOptionsSchema.parse({
          volume: 'invalid',
        }),
      ).toThrow();
    });
  });

  describe('builtinControlsSchema', () => {
    it('should allow boolean true', () => {
      expect(builtinControlsSchema.parse(true)).toBe(true);
    });

    it('should allow boolean false', () => {
      expect(builtinControlsSchema.parse(false)).toBe(false);
    });

    it('should allow options object', () => {
      expect(
        builtinControlsSchema.parse({
          play_pause: true,
          progress: false,
        }),
      ).toEqual({
        play_pause: true,
        progress: false,
        volume: true,
        fullscreen: true,
      });
    });
  });

  describe('resolveBuiltinControls', () => {
    it('should resolve undefined as default options', () => {
      expect(resolveBuiltinControls(undefined)).toEqual(builtinControlsOptionsDefault);
    });

    it('should resolve true as default options', () => {
      expect(resolveBuiltinControls(true)).toEqual(builtinControlsOptionsDefault);
    });

    it('should resolve false as null', () => {
      expect(resolveBuiltinControls(false)).toBeNull();
    });

    it('should resolve custom options object', () => {
      expect(
        resolveBuiltinControls({
          play_pause: true,
          progress: true,
          volume: false,
          fullscreen: false,
        }),
      ).toEqual({
        play_pause: true,
        progress: true,
        volume: false,
        fullscreen: false,
      });
    });

    it('should resolve partial options object with defaults', () => {
      expect(
        resolveBuiltinControls({
          play_pause: false,
          progress: true,
          volume: true,
          fullscreen: true,
        }),
      ).toEqual({
        play_pause: false,
        progress: true,
        volume: true,
        fullscreen: true,
      });
    });
  });

  describe('schema integration', () => {
    it('should accept builtin: false in live config', () => {
      const parsed = liveConfigSchema.parse({
        controls: {
          builtin: false,
        },
      });
      expect(parsed.controls.builtin).toBe(false);
    });

    it('should accept granular builtin in live config', () => {
      const parsed = liveConfigSchema.parse({
        controls: {
          builtin: {
            fullscreen: false,
            volume: false,
          },
        },
      });
      expect(parsed.controls.builtin).toEqual({
        play_pause: true,
        progress: true,
        volume: false,
        fullscreen: false,
      });
    });

    it('should accept builtin: false in viewer config', () => {
      const parsed = viewerConfigSchema.parse({
        controls: {
          builtin: false,
        },
      });
      expect(parsed.controls.builtin).toBe(false);
    });

    it('should accept granular builtin in viewer config', () => {
      const parsed = viewerConfigSchema.parse({
        controls: {
          builtin: {
            play_pause: true,
            progress: true,
            volume: false,
            fullscreen: false,
          },
        },
      });
      expect(parsed.controls.builtin).toEqual({
        play_pause: true,
        progress: true,
        volume: false,
        fullscreen: false,
      });
    });
  });
});
