import { z } from 'zod';

export const THUMBNAIL_SIZE_MIN = 75;
export const THUMBNAIL_SIZE_DEFAULT = 100;
export const THUMBNAIL_SIZE_MAX = 300;

const thumbnailStyleSchema = z.enum(['auto', 'plain', 'overlay', 'hover', 'panel']);
export type ThumbnailStyle = z.infer<typeof thumbnailStyleSchema>;

export const thumbnailsControlBaseDefaults = {
  size: THUMBNAIL_SIZE_DEFAULT,
  style: 'auto' as const,
  show_favorite_control: true,
  show_timeline_control: false,
  show_download_control: false,
  show_review_control: true,
  show_info_control: true,
  chunk_hours: 24,
};

// Configuration for the actual rendered thumbnail.
export const thumbnailsControlBaseSchema = z.object({
  size: z
    .number()
    .min(THUMBNAIL_SIZE_MIN)
    .max(THUMBNAIL_SIZE_MAX)
    .default(thumbnailsControlBaseDefaults.size),
  style: thumbnailStyleSchema.default(thumbnailsControlBaseDefaults.style),
  show_favorite_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_favorite_control),
  show_timeline_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_timeline_control),
  show_download_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_download_control),
  show_review_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_review_control),
  show_info_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_info_control),
  chunk_hours: z
    .union([
      z.number(),
      z
        .string()
        .regex(/^\s*\d+\s*h?\s*$/i)
        .transform((val) => parseInt(val.replace(/h/i, '').trim(), 10)),
    ])
    .pipe(z.number().min(1).max(24))
    .optional()
    .default(thumbnailsControlBaseDefaults.chunk_hours),
  chunk_size: z
    .union([
      z.number(),
      z
        .string()
        .regex(/^\s*\d+\s*$/)
        .transform((val) => parseInt(val.trim(), 10)),
    ])
    .pipe(z.number().min(1).max(100))
    .optional(),
});
export type ThumbnailsControlBaseConfig = z.infer<typeof thumbnailsControlBaseSchema>;

const THUMBNAIL_DRAWER_POSITIONS = ['center', 'top', 'bottom', 'selected'] as const;

export const thumbnailsControlDefaults = {
  ...thumbnailsControlBaseDefaults,
  mode: 'right' as const,
  position: 'center' as const,
};

export const thumbnailsControlSchema = thumbnailsControlBaseSchema.extend({
  mode: z
    .enum(['none', 'above', 'below', 'left', 'right'])
    .default(thumbnailsControlDefaults.mode),
  position: z
    .union([z.enum(THUMBNAIL_DRAWER_POSITIONS), z.string(), z.number()])
    .optional()
    .default(thumbnailsControlDefaults.position),
});
export type ThumbnailsControlConfig = z.infer<typeof thumbnailsControlSchema>;
