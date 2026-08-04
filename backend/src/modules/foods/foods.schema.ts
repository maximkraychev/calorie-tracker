import { z } from 'zod';

// GET /api/foods/search?q=&limit=
//
// `q` is free text in any language — Bulgarian included, which is why nothing here
// restricts the character set. Length is capped so a pathological query cannot turn into
// a pathological regex against 5,000 rows on a 0.1-CPU instance.
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  // Kept small: the Add-Food overlay merges these with Open Food Facts results, so a
  // long tail of near-identical USDA cuts would bury the branded matches.
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ---------------------------------------------------------------------------
// Custom foods (ARCHITECTURE.md §4.2) — the user's own catalog.
// ---------------------------------------------------------------------------

// numeric(7,2) columns top out at 99999.99; cap here so a huge value is a 400, not a
// numeric-overflow 500.
const NUMERIC_7_2_MAX = 99999.99;

// The same ranges as diary.schema.ts, deliberately duplicated rather than shared: each
// module's Zod mirrors the CHECK constraints on ITS OWN table. These are the
// `custom_foods_*_range` checks; the diary's are `log_entries_*_range`. They happen to
// agree today, and nothing should force them to agree tomorrow.
const per100gSchema = z.object({
  kcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
});

// POST /api/foods and PUT /api/foods/:id share this body — the update is a full replace,
// so an omitted `brand`/`servingSizeG` clears the stored value rather than keeping it.
export const customFoodBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullish(),
  per100g: per100gSchema,
  servingSizeG: z.number().positive().max(NUMERIC_7_2_MAX).nullish(),
});

// GET /api/foods?q= — `q` is optional; without it the whole catalog comes back. A user
// has tens of foods, not thousands, so there is no pagination.
export const customFoodListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
});

export const foodIdSchema = z.object({ id: z.uuid() });

export type CustomFoodBody = z.infer<typeof customFoodBodySchema>;
