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
