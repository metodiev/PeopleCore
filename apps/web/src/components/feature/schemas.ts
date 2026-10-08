import type { TFunction } from 'i18next';
import { z } from 'zod';

/** Required text with a localised message. */
export const requiredText = (t: TFunction, maxLength = 200) =>
  z.string().min(1, t('validation.required')).max(maxLength, t('validation.maxLength', { count: maxLength }));

/** Optional text normalised to `undefined` when left empty. */
export const optionalText = (maxLength = 500) =>
  z
    .string()
    .max(maxLength)
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value : undefined));

export const emailField = (t: TFunction) =>
  z.string().min(1, t('validation.required')).email(t('validation.email'));

export const passwordField = (t: TFunction, minLength = 12) =>
  z.string().min(minLength, t('validation.minLength', { count: minLength })).max(128);

/**
 * Form value helper: converts an optional number input into a number or
 * undefined. Register the input with `{ valueAsNumber: true }`.
 */
export const optionalNumber = (t: TFunction, options: { min?: number; max?: number } = {}) =>
  z
    .union([z.number(), z.nan()])
    .optional()
    .transform((value) => (value === undefined || Number.isNaN(value) ? undefined : value))
    .refine((value) => value === undefined || options.min === undefined || value >= options.min, {
      message: t('validation.min', { count: options.min ?? 0 }),
    })
    .refine((value) => value === undefined || options.max === undefined || value <= options.max, {
      message: t('validation.max', { count: options.max ?? 0 }),
    });

/** Form value helper: required number. Register with `{ valueAsNumber: true }`. */
export const numberField = (t: TFunction, options: { min?: number; max?: number } = {}) =>
  z
    .number({ message: t('validation.number') })
    .refine((value) => options.min === undefined || value >= options.min, {
      message: t('validation.min', { count: options.min ?? 0 }),
    })
    .refine((value) => options.max === undefined || value <= options.max, {
      message: t('validation.max', { count: options.max ?? 0 }),
    });

/** Form value helper: optional ISO date (yyyy-mm-dd from a date input). */
export const optionalDate = () =>
  z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));
