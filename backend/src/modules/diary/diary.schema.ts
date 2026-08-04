import { z } from 'zod';

// Zod ranges mirror the DB CHECK constraints on log_entries (schema.ts:
// per100gChecks + grams/serving positivity) so bad Open Food Facts data is
// rejected as a 400 here rather than blowing up as a 500 at the INSERT.

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

// Sources that necessarily carry client-supplied nutrition: there is no server-side
// source of truth for an Open Food Facts hit, a USDA catalog pick, an AI estimate or a
// typed-in food. 'recipe' is absent because the recipes module doesn't exist yet, so it
// falls through the union below and is rejected as a 400.
const EXTERNAL_SOURCES = ['search', 'generic', 'barcode', 'ai', 'manual'] as const;

// numeric(7,2) columns top out at 99999.99; cap here so a huge value is a 400, not a
// numeric-overflow 500.
const NUMERIC_7_2_MAX = 99999.99;

const per100gSchema = z.object({
  kcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
});

// One item to log, from a source with no server-side record: the client sends the
// nutrition because nothing else can. `externalId` is the OFF product code or USDA fdcId,
// provenance only.
const externalEntryItemSchema = z.object({
  source: z.enum(EXTERNAL_SOURCES),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullish(),
  grams: z.number().positive().max(NUMERIC_7_2_MAX),
  per100g: per100gSchema,
  servingSizeG: z.number().positive().max(NUMERIC_7_2_MAX).nullish(),
  externalId: z.string().trim().max(64).nullish(),
});

// A custom food, where the server IS the source of truth (ARCHITECTURE.md §4.4). Only an
// id and a portion are accepted; Zod strips unknown keys, so a client that also sends
// name/brand/per100g has them silently discarded rather than trusted. That discard is the
// trust boundary — the service reads the real values out of custom_foods.
const customEntryItemSchema = z.object({
  source: z.literal('custom'),
  customFoodId: z.uuid(),
  grams: z.number().positive().max(NUMERIC_7_2_MAX),
});

// Discriminated on `source`, so an unhandled source ('recipe') matches no branch and
// comes back as a 400 rather than reaching the insert.
const newEntryItemSchema = z.discriminatedUnion('source', [
  externalEntryItemSchema,
  customEntryItemSchema,
]);

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
