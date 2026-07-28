import { env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';
import { logger } from '../../utils/logger.js';
import { buildPrompt, PROMPT_VERSION, RESPONSE_SCHEMA } from './prompt.v1.js';
import type {
  Confidence,
  EstimateInput,
  Per100g,
  PhotoEstimateProvider,
  VisionItem,
  VisionResult,
} from './types.js';

// Google exposes two surfaces: the newer /v1beta/interactions and this one. We use
// generateContent — it is labelled "legacy" but explicitly remains fully supported, and
// unlike interactions its *response* shape is documented, which matters for an endpoint
// we cannot smoke-test without a key. Model ids drift (gemini-3-flash-preview,
// gemini-3.1-flash-lite, gemini-3.6-flash have all appeared), so the id is env-driven:
//   curl -H "x-goog-api-key: $KEY" https://generativelanguage.googleapis.com/v1beta/models
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Vision calls are typically 2-5s; the ceiling covers a cold start plus retry headroom.
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_BACKOFF_MS = 1_000;

const CONFIDENCES = ['high', 'medium', 'low'] as const;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export const geminiProvider: PhotoEstimateProvider = {
  name: 'gemini',
  promptVersion: PROMPT_VERSION,

  async estimate(input: EstimateInput): Promise<VisionResult> {
    // Not reachable via the API (env.ts refuses to boot without it), but the adapter
    // shouldn't assume its own precondition.
    if (!env.GEMINI_API_KEY) {
      throw new AppError('Photo estimation is not configured', 503);
    }

    const raw = await callGemini(buildPrompt(input.locale, input.note), input);

    try {
      return normalize(JSON.parse(raw));
    } catch {
      // A schema-constrained model rarely emits invalid JSON, but when it does a single
      // stricter retry usually settles it.
      logger.warn('Gemini returned unparseable JSON; retrying with a stricter reminder');
      const stricter = `${buildPrompt(input.locale, input.note)}

# CRITICAL
Your previous response was not valid JSON. Return ONLY a single JSON object matching the
required schema. No markdown fences, no commentary, no trailing text.`;

      const retried = await callGemini(stricter, input);
      try {
        return normalize(JSON.parse(retried));
      } catch {
        throw new AppError('The photo could not be analysed. Please try again.', 502);
      }
    }
  },
};

async function callGemini(prompt: string, input: EstimateInput): Promise<string> {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: input.image.mimeType,
              data: input.image.data.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(RESPONSE_SCHEMA),
    },
  };

  const url = `${API_BASE}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
  // Retry once on transient failures (network, timeout, 429, 5xx); anything else is a
  // config or content problem that a retry won't fix.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await delay(RETRY_BACKOFF_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Never log this header or the request body — the body carries image bytes.
          'x-goog-api-key': env.GEMINI_API_KEY!,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, attempt }, 'Gemini request failed');
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      logger.warn({ status: response.status, attempt }, 'Gemini transient error');
      continue;
    }

    if (!response.ok) {
      // 400/403 here means a bad key, an unknown model id, or a rejected image — all
      // operator problems. Log the detail; don't leak it to the client.
      const detail = await response.text().catch(() => '');
      logger.error(
        { status: response.status, detail: detail.slice(0, 500), model: env.GEMINI_MODEL },
        'Gemini rejected the request',
      );
      throw new AppError('The photo could not be analysed. Please try again.', 502);
    }

    const payload = (await response.json()) as GeminiResponse;
    console.log('Gemini response payload:', JSON.stringify(payload, null, 2));
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      // Safety filters and MAX_TOKENS both land here with no usable text.
      logger.error(
        {
          finishReason: payload.candidates?.[0]?.finishReason,
          blockReason: payload.promptFeedback?.blockReason,
        },
        'Gemini returned no content',
      );
      throw new AppError('The photo could not be analysed. Please try again.', 502);
    }

    return text;
  }

  throw new AppError(
    'The photo service is temporarily unavailable. You can add the food manually.',
    503,
  );
}

/**
 * `generationConfig.responseSchema` takes the OpenAPI-flavoured subset — `type` values
 * are upper-case and unknown keywords are rejected. Translating here keeps
 * `prompt.v1.ts` provider-neutral so the next adapter can feed it plain JSON Schema.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'type' && typeof value === 'string') out[key] = value.toUpperCase();
    else if (key === 'properties' || key === 'items') out[key] = toGeminiSchema(value);
    else out[key] = value;
  }
  return out;
}

// The model is schema-constrained, but a schema guarantees shape, not sanity — grams can
// still come back negative and enums can still drift. Everything below is coerced or
// dropped rather than trusted.
function normalize(payload: unknown): VisionResult {
  const root = asRecord(payload);
  const rawItems = Array.isArray(root.items) ? root.items : [];

  const items = rawItems.map(toVisionItem).filter((item): item is VisionItem => item !== null);

  return {
    items,
    scaleReferenceUsed: asText(root.scaleReferenceUsed),
    hiddenFatsNote: asText(root.hiddenFatsNote),
    overallConfidence: asConfidence(root.overallConfidence) ?? 'low',
    clarifyingQuestion: asText(root.clarifyingQuestion),
  };
}

function toVisionItem(raw: unknown): VisionItem | null {
  const item = asRecord(raw);
  const displayName = asText(item.displayName);
  const searchTerm = asText(item.searchTerm);
  const grams = asNumber(item.grams);

  // No name or no positive weight means there is nothing to log or look up.
  if (!displayName || !searchTerm || grams === null || grams <= 0) return null;

  return {
    displayName,
    searchTerm,
    grams,
    confidence: asConfidence(item.confidence) ?? 'low',
    cookingMethod: asText(item.cookingMethod),
    fallbackPer100g: toPer100g(item.fallbackPer100g),
  };
}

function toPer100g(raw: unknown): Per100g {
  const value = asRecord(raw);
  // Clamped to the same ranges as the diary's CHECK constraints, so a wild fallback
  // can't 400 at save time after the user has already edited the list.
  return {
    kcal: clamp(asNumber(value.kcal) ?? 0, 0, 900),
    protein: clamp(asNumber(value.protein) ?? 0, 0, 100),
    carbs: clamp(asNumber(value.carbs) ?? 0, 0, 100),
    fat: clamp(asNumber(value.fat) ?? 0, 0, 100),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}

function asConfidence(value: unknown): Confidence | null {
  return typeof value === 'string' && (CONFIDENCES as readonly string[]).includes(value)
    ? (value as Confidence)
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
