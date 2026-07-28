import { searchFdc, type FdcMatch } from '../../services/fdc.js';
import { photoEstimateProvider } from '../../services/photo-estimate/index.js';
import type { Confidence, Per100g, VisionItem } from '../../services/photo-estimate/types.js';
import { logger } from '../../utils/logger.js';
import type { AnalyzeBody } from './estimates.schema.js';

// Nothing here is persisted. The photo is forwarded to the provider and dropped; the
// items are returned, edited in the browser, and only the user's confirmed choices reach
// the database — as ordinary diary entries with source 'ai'.

export interface EstimateAlternative {
  fdcId: number;
  name: string;
  per100g: Per100g;
}

export interface EstimateItem {
  /** Stable within one response only — a client-side list key, not an entity id. */
  id: string;
  displayName: string;
  grams: number;
  confidence: Confidence;
  /** True when FDC had no usable match: per100g is the model's own guess. Flag it in the UI. */
  unresolved: boolean;
  fdcId: number | null;
  /** Present on every item, which is what lets the client recompute edits with no network. */
  per100g: Per100g;
  /** Other FDC matches for the same term — powers "swap this food" without a round trip. */
  alternatives: EstimateAlternative[];
}

export interface PhotoEstimate {
  items: EstimateItem[];
  overallConfidence: Confidence;
  scaleReferenceUsed: string | null;
  hiddenFatsNote: string | null;
  clarifyingQuestion: string | null;
}

export async function analyzePhoto(
  image: { data: Buffer; mimeType: string },
  body: AnalyzeBody,
): Promise<PhotoEstimate> {
  const startedAt = Date.now();
  const vision = await photoEstimateProvider.estimate({
    image,
    note: body.note,
    locale: body.locale,
  });

  // Sequential lookups would add roughly a second of avoidable latency to every
  // analysis; a typical meal is 4-6 terms.
  const items = await Promise.all(vision.items.map(resolveItem));

  logger.info(
    {
      provider: photoEstimateProvider.name,
      promptVersion: photoEstimateProvider.promptVersion,
      locale: body.locale,
      hasNote: Boolean(body.note),
      items: items.length,
      unresolved: items.filter((item) => item.unresolved).length,
      ms: Date.now() - startedAt,
    },
    'Photo estimate completed',
  );

  return {
    items,
    overallConfidence: vision.overallConfidence,
    scaleReferenceUsed: vision.scaleReferenceUsed,
    hiddenFatsNote: vision.hiddenFatsNote,
    clarifyingQuestion: vision.clarifyingQuestion,
  };
}

/**
 * Resolve one ingredient against FDC, degrading to the model's own guess rather than
 * failing. A meal with four verified items and one flagged one is a useful result; a
 * 503 because one term missed is not.
 */
async function resolveItem(item: VisionItem, index: number): Promise<EstimateItem> {
  const base = {
    id: `i${index}`,
    displayName: item.displayName,
    grams: round2(item.grams),
    confidence: item.confidence,
  };

  let matches: FdcMatch[] = [];
  try {
    matches = await searchFdc(item.searchTerm);
  } catch (err) {
    // Rate limits and outages land here. Loud, because a silent fallback would quietly
    // fill the diary with unverified model guesses.
    logger.error(
      { err: (err as Error).message, searchTerm: item.searchTerm },
      'FDC lookup failed — falling back to the model estimate',
    );
  }

  const [best, ...rest] = matches;
  if (!best) {
    logger.warn({ searchTerm: item.searchTerm }, 'No FDC match — item is unresolved');
    return {
      ...base,
      unresolved: true,
      fdcId: null,
      per100g: item.fallbackPer100g,
      alternatives: [],
    };
  }

  return {
    ...base,
    unresolved: false,
    fdcId: best.fdcId,
    per100g: best.per100g,
    alternatives: rest,
  };
}

/** GET /api/estimates/foods?q= — manual add for anything the model missed. */
export async function searchFoods(query: string): Promise<EstimateAlternative[]> {
  return searchFdc(query);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
