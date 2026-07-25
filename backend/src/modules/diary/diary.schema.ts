import { z } from 'zod';

// Zod ranges mirror the DB CHECK constraints on log_entries (schema.ts:
// per100gChecks + grams/serving positivity) so bad Open Food Facts data is
// rejected as a 400 here rather than blowing up as a 500 at the INSERT.

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

// Only external sources are accepted for now. 'custom'/'recipe' need the server to
// resolve the snapshot from custom_foods/recipes — modules that don't exist yet — so
// they're rejected (invalid enum → 400) until those land.
const EXTERNAL_SOURCES = ['search', 'barcode', 'ai', 'manual'] as const;

// numeric(7,2) columns top out at 99999.99; cap here so a huge value is a 400, not a
// numeric-overflow 500.
const NUMERIC_7_2_MAX = 99999.99;

const per100gSchema = z.object({
  kcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
});

// One item to log. External sources always carry client-supplied nutrition (there is no
// server-side source of truth for an OFF result or a typed-in food); `externalId` is the
// OFF product code, provenance only.
const newEntryItemSchema = z.object({
  source: z.enum(EXTERNAL_SOURCES),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullish(),
  grams: z.number().positive().max(NUMERIC_7_2_MAX),
  per100g: per100gSchema,
  servingSizeG: z.number().positive().max(NUMERIC_7_2_MAX).nullish(),
  externalId: z.string().trim().max(64).nullish(),
});

// POST /api/diary/entries — batch add under one date + meal (the UI logs one at a time,
// but the contract is a batch so the multi-add flow can post once).
export const createEntriesSchema = z.object({
  date: z.iso.date(),
  meal: z.enum(MEALS),
  items: z.array(newEntryItemSchema).min(1).max(50),
});

// PATCH /api/diary/entries/:id — any subset, but at least one field.
export const updateEntrySchema = z
  .object({
    grams: z.number().positive().max(NUMERIC_7_2_MAX).optional(),
    meal: z.enum(MEALS).optional(),
    date: z.iso.date().optional(),
  })
  .refine((v) => v.grams !== undefined || v.meal !== undefined || v.date !== undefined, {
    message: 'At least one of grams, meal, or date is required',
  });

export const dateQuerySchema = z.object({ date: z.iso.date() });

export const entryIdSchema = z.object({ id: z.uuid() });

export type NewEntryItem = z.infer<typeof newEntryItemSchema>;
export type CreateEntriesBody = z.infer<typeof createEntriesSchema>;
export type UpdateEntryBody = z.infer<typeof updateEntrySchema>;
