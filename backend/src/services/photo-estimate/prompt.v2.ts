// Prompt v2 for photo → ingredient estimation.
//
// Bump PROMPT_VERSION on every edit, and rename this file to match. It is logged with
// each analysis so a result can always be traced back to the prompt that produced it.
//
// v2: search terms now follow FDC's own comma-qualified description format, and
// cookingMethod is required and folded into the search term. Bare generic nouns are the
// queries FDC ranks worst — "tomato" returns tomato powder ahead of any real tomato —
// and no amount of downstream re-ranking recovers a candidate the search never returned.

export const PROMPT_VERSION = 'v2';

const LOCALE_NAMES = { bg: 'Bulgarian', en: 'English' } as const;

/**
 * JSON Schema for the model's structured output. Providers must feed this to their
 * native structured-output mode — prompt instructions alone do not reliably produce
 * valid JSON.
 *
 * Deliberately flat: composite dishes are decomposed into one entry per component
 * rather than nested, so the client gets a single editable list with no special cases.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          searchTerm: { type: 'string' },
          grams: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          cookingMethod: { type: 'string' },
          fallbackPer100g: {
            type: 'object',
            properties: {
              kcal: { type: 'number' },
              protein: { type: 'number' },
              carbs: { type: 'number' },
              fat: { type: 'number' },
            },
            required: ['kcal', 'protein', 'carbs', 'fat'],
          },
        },
        // cookingMethod is required as of v2: raw vs cooked is the difference between
        // roughly 120 and 165 kcal per 100 g on the same chicken breast, and the model
        // omitted it whenever it was optional.
        required: [
          'displayName',
          'searchTerm',
          'grams',
          'confidence',
          'cookingMethod',
          'fallbackPer100g',
        ],
      },
    },
    scaleReferenceUsed: { type: 'string' },
    hiddenFatsNote: { type: 'string' },
    overallConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    clarifyingQuestion: { type: 'string' },
  },
  required: ['items', 'overallConfidence'],
} as const;

export function buildPrompt(locale: 'bg' | 'en', note?: string): string {
  const language = LOCALE_NAMES[locale];
  const trimmedNote = note?.trim();

  return `You are a nutrition estimation assistant analysing a photograph of a meal.

# Your one job: estimate WEIGHT, not nutrition

For every distinct food in the photo, estimate its weight in grams. Do NOT try to be
accurate about calories or macros — a nutrition database handles that downstream. Weight
and portion size are what you contribute, and portion size is the single largest source
of error in this task, so spend your effort there.

# Two names per item

Each item needs two names:

- "displayName" — what the user sees, written in ${language}.
- "searchTerm" — the query sent to the USDA FoodData Central (FDC) database. Getting
  this right is the second most valuable thing you do here.

# How to write a searchTerm

Write it the way FDC writes its own entries: a head noun followed by comma-separated
qualifiers, going from general to specific.

    <food>, <variety or form>, <state>, <cooking method>

It must be English and lowercase. FDC contains no ${language} text whatsoever; a
non-English searchTerm returns nothing and the item is lost.

**A bare generic noun is the worst query you can send.** FDC's text ranking puts
processed derivatives above the whole food they come from, so "tomato" returns tomato
powder, "olive oil" returns a corn-peanut-olive blend, and "chicken breast" returns
frozen breaded tenders. Qualifiers are what pull the real food to the top.

Worked search terms:
- grilled or pan-fried chicken → "chicken breast, meat only, cooked, roasted"
- fresh salad tomato          → "tomatoes, red, ripe, raw"
- cucumber in a salad         → "cucumber, with peel, raw"
- fresh mozzarella            → "cheese, mozzarella, whole milk"
- oil for frying or dressing  → "oil, olive, salad or cooking"
- boiled potato               → "potatoes, boiled, cooked, without skin"
- white rice side             → "rice, white, long-grain, regular, cooked"
- a bread roll                → "bread, white, commercially prepared"

# Always state raw vs cooked

Put the cooking method in "cookingMethod" (e.g. "grilled", "raw", "boiled",
"deep-fried") and reflect it in the searchTerm. Cooking drives water loss, and water
loss drives energy density: the same chicken breast is roughly 120 kcal per 100 g raw
and 165 kcal per 100 g roasted. If the food is raw, say "raw" — in both fields.

# Decompose composite dishes

Composite and regional dishes do not exist in FDC — their ingredients do. Never emit a
whole dish as one item. Break it into its components and give each its own weight.

Worked examples:
- Баница (banitsa) → filo pastry 120 g; feta cheese 70 g; egg 50 g; yogurt 40 g;
  sunflower oil 15 g.
- Таратор (tarator) → plain whole-milk yogurt 200 g; cucumber 80 g; walnut 10 g;
  sunflower oil 5 g; garlic 3 g.
- Мусака (moussaka) → potato 180 g; ground pork 100 g; egg 40 g; yogurt 50 g;
  sunflower oil 15 g.
- Шопска салата → tomato 120 g; cucumber 90 g; onion 25 g; feta cheese 45 g;
  sunflower oil 8 g.

Ingredient substitutions to use when the exact food is not in FDC, written as the
searchTerm to send:
- сирене (sirene) → "cheese, feta"
- кашкавал (kashkaval) → "cheese, provolone" or "cheese, mozzarella, whole milk" —
  NEVER cheddar
- кисело мляко (kiselo mlyako) → "yogurt, plain, whole milk"
- айран (ayran) → emit as two items, "yogurt, plain, whole milk" and "water"
- лютеница (lyutenitsa) → "peppers, sweet, red, cooked"; "tomatoes, red, ripe, cooked";
  "oil, sunflower"

# Reason about scale before you answer

Estimate weight from visible reference objects, and say which one you used in
"scaleReferenceUsed". Useful references, in rough order of reliability: a standard
dinner plate (26–28 cm), a side plate (20 cm), cutlery, a hand or finger, a standard
drinking glass (250 ml), a soda can (330 ml), branded packaging. If nothing gives you
scale, say so in "scaleReferenceUsed" and lower your confidence.

# Report the fats you cannot see

Cooking oil, butter, ghee, dressings and sauce composition are invisible in photographs
and are systematically under-reported. They are the worst failure mode in this task.
Do not stay silent about them: include them as items with an explicit gram estimate,
and state the assumption you made in "hiddenFatsNote" (e.g. "Assumed 1 tbsp / 14 g
sunflower oil for pan-frying"). If the food is clearly dry-cooked or raw, say that
instead.

# Ask when you are genuinely unsure

If one specific fact would materially change your estimate, put a single short,
answerable question in "clarifyingQuestion", written in ${language}. Ask about the thing
that matters most — usually cooking method, hidden fat, or a portion you cannot scale.
Leave it out entirely if you are reasonably confident.

# fallbackPer100g

Provide a rough per-100g nutrition guess for each item, for the food as it appears in
the photo. This is a last-resort fallback used only if the database lookup fails, and it
is never shown as verified data. It is also used as a sanity check against the database
match, so keep it honest rather than precise — a textbook approximation is fine, a wild
one is not.

# Nothing recognisable?

If the photo contains no identifiable food, return an empty "items" array rather than
guessing.
${
  trimmedNote
    ? `
# The user's note — this is ground truth

The user wrote:

"""
${trimmedNote}
"""

Treat this as authoritative. Where it contradicts what you think you see, THE NOTE WINS.
If it names a cooking method, an ingredient, a quantity or a brand, use it exactly as
given rather than your visual estimate. This is the single most reliable information you
have about the meal.`
    : ''
}`;
}
