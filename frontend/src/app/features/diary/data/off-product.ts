import type { FoodSearchResult } from '../models/food-search.models';

// The shape of an Open Food Facts product, limited to the fields we request. Shared by
// both OFF paths — full-text search (food-search.api.ts) and barcode lookup
// (barcode-lookup.api.ts) — since they return the same product object and normalize it
// to the app's `FoodSearchResult` the same way. `product_name` is localized via `lc`;
// `brands` is a comma-separated string. `nutriments` holds label data;
// `nutriments_estimated` is OFF's ingredient-based estimate, present for unlabelled
// products (fresh produce). `nova_group` (1–4) is the processing level.
export type Nutriments = Partial<Record<string, number>>;

export interface Product {
  code?: string;
  product_name?: string;
  brands?: string;
  nova_group?: number;
  nutriments?: Nutriments;
  nutriments_estimated?: Nutriments;
}

// Normalize an OFF product to the app's per-100g shape. Products without a usable name,
// barcode, or kcal value return null rather than being shown as 0 kcal.
export function toResult(product: Product): FoodSearchResult | null {
  const name = product.product_name?.trim();
  const nutriments = pickNutriments(product);
  if (!product.code || !name || !nutriments) return null;
  return {
    code: product.code,
    name,
    brand: product.brands?.split(',')[0]?.trim() || null,
    // OFF has no Bulgarian catalog of its own; `lc` already localizes `product_name`,
    // so there is no second name to carry.
    source: 'search',
    kcalPer100g: nutriments['energy-kcal_100g']!,
    proteinPer100g: nutriments['proteins_100g'] ?? 0,
    carbsPer100g: nutriments['carbohydrates_100g'] ?? 0,
    fatPer100g: nutriments['fat_100g'] ?? 0,
  };
}

// Label data first, OFF's estimate as fallback; null when neither has a kcal value.
export function pickNutriments(product: Product): Nutriments | null {
  for (const nutriments of [product.nutriments, product.nutriments_estimated]) {
    if (typeof nutriments?.['energy-kcal_100g'] === 'number') return nutriments;
  }
  return null;
}
