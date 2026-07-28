import { z } from 'zod';

// Multipart text fields arrive as strings on req.body; the file lands on req.file and is
// validated by multer's fileFilter/limits, not here.

export const analyzeBodySchema = z.object({
  // The user's free-text context ("fried in 2 tbsp of oil"). The single largest accuracy
  // lever available, and treated as ground truth by the prompt — hence the generous cap.
  note: z.string().trim().max(500).optional(),
  locale: z.enum(['bg', 'en']).default('en'),
});

// GET /api/estimates/foods?q= — the FDC proxy behind the "add a missing item" search.
export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export type AnalyzeBody = z.infer<typeof analyzeBodySchema>;
