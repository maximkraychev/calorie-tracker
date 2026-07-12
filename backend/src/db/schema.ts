import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const mealType = pgEnum('meal_type', ['breakfast', 'lunch', 'dinner', 'snack']);

// Provenance of a nutrition snapshot. 'search' | 'barcode' = Open Food Facts,
// 'ai' = photo estimate, 'recipe' = logged from a recipe, 'custom' = user's
// custom food, 'manual' = typed in by hand.
export const foodSource = pgEnum('food_source', [
  'search',
  'barcode',
  'ai',
  'recipe',
  'custom',
  'manual',
]);

export const recipeNutritionMode = pgEnum('recipe_nutrition_mode', ['ingredients', 'manual']);

// ---------------------------------------------------------------------------
// Shared column shapes
// ---------------------------------------------------------------------------

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// Per-100g nutrition snapshot. Copied from the source (OFF result, custom food,
// AI estimate, recipe) at the moment of logging — never a foreign key.
const per100g = {
  kcalPer100g: numeric('kcal_per_100g', { precision: 7, scale: 2 }).notNull(),
  proteinPer100g: numeric('protein_per_100g', { precision: 6, scale: 2 }).notNull(),
  carbsPer100g: numeric('carbs_per_100g', { precision: 6, scale: 2 }).notNull(),
  fatPer100g: numeric('fat_per_100g', { precision: 6, scale: 2 }).notNull(),
};

interface Per100gColumns {
  kcalPer100g: AnyPgColumn;
  proteinPer100g: AnyPgColumn;
  carbsPer100g: AnyPgColumn;
  fatPer100g: AnyPgColumn;
}

const per100gChecks = (prefix: string, t: Per100gColumns) => [
  check(`${prefix}_kcal_per_100g_range`, sql`${t.kcalPer100g} >= 0 AND ${t.kcalPer100g} <= 900`),
  check(
    `${prefix}_macros_per_100g_range`,
    sql`${t.proteinPer100g} >= 0 AND ${t.proteinPer100g} <= 100
        AND ${t.carbsPer100g} >= 0 AND ${t.carbsPer100g} <= 100
        AND ${t.fatPer100g} >= 0 AND ${t.fatPer100g} <= 100`,
  ),
];

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
).enableRLS();

// ---------------------------------------------------------------------------
// refresh_tokens — opaque tokens stored as SHA-256 hashes, rotated per use.
// family_id groups a rotation chain; reuse of a revoked token revokes the family.
// ---------------------------------------------------------------------------

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_idx').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_id_idx').on(t.familyId),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// custom_foods — the ONLY persisted food catalog (user-created). External
// search/barcode results are never stored here; they exist only as snapshots
// on log_entries / recipe_ingredients.
// ---------------------------------------------------------------------------

export const customFoods = pgTable(
  'custom_foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    ...per100g,
    // Optional display serving; grams stay the source of truth everywhere.
    servingSizeG: numeric('serving_size_g', { precision: 7, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    index('custom_foods_user_id_idx').on(t.userId),
    index('custom_foods_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    check('custom_foods_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check(
      'custom_foods_serving_size_positive',
      sql`${t.servingSizeG} IS NULL OR ${t.servingSizeG} > 0`,
    ),
    ...per100gChecks('custom_foods', t),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// recipes — two modes:
//  'ingredients': nutrition computed from recipe_ingredients snapshots;
//                 total_weight_g optional (defaults to sum of ingredient grams,
//                 override it for cooked weight).
//  'manual':      flat totals for the whole recipe; total_weight_g required so
//                 logged grams can scale; no ingredient rows (API-enforced).
// ---------------------------------------------------------------------------

export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nutritionMode: recipeNutritionMode('nutrition_mode').notNull(),
    totalWeightG: numeric('total_weight_g', { precision: 8, scale: 2 }),
    kcalTotal: numeric('kcal_total', { precision: 8, scale: 2 }),
    proteinTotalG: numeric('protein_total_g', { precision: 7, scale: 2 }),
    carbsTotalG: numeric('carbs_total_g', { precision: 7, scale: 2 }),
    fatTotalG: numeric('fat_total_g', { precision: 7, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    index('recipes_user_id_idx').on(t.userId),
    index('recipes_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    check('recipes_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check('recipes_total_weight_positive', sql`${t.totalWeightG} IS NULL OR ${t.totalWeightG} > 0`),
    check(
      'recipes_mode_shape',
      sql`(${t.nutritionMode} = 'manual'
            AND ${t.totalWeightG} IS NOT NULL
            AND ${t.kcalTotal} IS NOT NULL AND ${t.kcalTotal} >= 0
            AND ${t.proteinTotalG} IS NOT NULL AND ${t.proteinTotalG} >= 0
            AND ${t.carbsTotalG} IS NOT NULL AND ${t.carbsTotalG} >= 0
            AND ${t.fatTotalG} IS NOT NULL AND ${t.fatTotalG} >= 0)
        OR (${t.nutritionMode} = 'ingredients'
            AND ${t.kcalTotal} IS NULL
            AND ${t.proteinTotalG} IS NULL
            AND ${t.carbsTotalG} IS NULL
            AND ${t.fatTotalG} IS NULL)`,
    ),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// recipe_ingredients — snapshot rows (only for 'ingredients'-mode recipes).
// custom_food_id / external_id are provenance only; nutrition lives here.
// ---------------------------------------------------------------------------

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    brand: text('brand'),
    source: foodSource('source').notNull(),
    customFoodId: uuid('custom_food_id').references(() => customFoods.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    grams: numeric('grams', { precision: 7, scale: 2 }).notNull(),
    ...per100g,
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recipe_ingredients_recipe_id_idx').on(t.recipeId, t.position),
    index('recipe_ingredients_custom_food_id_idx').on(t.customFoodId),
    check('recipe_ingredients_grams_positive', sql`${t.grams} > 0`),
    check('recipe_ingredients_name_not_blank', sql`length(trim(${t.name})) > 0`),
    ...per100gChecks('recipe_ingredients', t),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// log_entries — the diary. One row per logged item; date + meal categorize it.
// Nutrition is a per-100g snapshot; per-entry totals are generated columns so
// daily/period aggregation is a plain SUM.
// ---------------------------------------------------------------------------

export const logEntries = pgTable(
  'log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date').notNull(),
    meal: mealType('meal').notNull(),
    name: text('name').notNull(),
    brand: text('brand'),
    source: foodSource('source').notNull(),
    grams: numeric('grams', { precision: 7, scale: 2 }).notNull(),
    ...per100g,
    // Snapshot of the source's serving size, so the API can derive a display
    // "servings" number (grams / serving_size_g). Never authoritative.
    servingSizeG: numeric('serving_size_g', { precision: 7, scale: 2 }),
    // Provenance only — safe to null out when the source row is deleted.
    customFoodId: uuid('custom_food_id').references(() => customFoods.id, {
      onDelete: 'set null',
    }),
    recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    // Derived per-entry totals (immutable expressions → stored generated cols).
    kcal: numeric('kcal', { precision: 9, scale: 2 }).generatedAlwaysAs(
      sql`round(("grams" * "kcal_per_100g") / 100.0, 2)`,
    ),
    proteinG: numeric('protein_g', { precision: 8, scale: 2 }).generatedAlwaysAs(
      sql`round(("grams" * "protein_per_100g") / 100.0, 2)`,
    ),
    carbsG: numeric('carbs_g', { precision: 8, scale: 2 }).generatedAlwaysAs(
      sql`round(("grams" * "carbs_per_100g") / 100.0, 2)`,
    ),
    fatG: numeric('fat_g', { precision: 8, scale: 2 }).generatedAlwaysAs(
      sql`round(("grams" * "fat_per_100g") / 100.0, 2)`,
    ),
    ...timestamps,
  },
  (t) => [
    index('log_entries_user_date_idx').on(t.userId, t.entryDate),
    index('log_entries_custom_food_id_idx').on(t.customFoodId),
    index('log_entries_recipe_id_idx').on(t.recipeId),
    check('log_entries_grams_positive', sql`${t.grams} > 0`),
    check('log_entries_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check(
      'log_entries_serving_size_positive',
      sql`${t.servingSizeG} IS NULL OR ${t.servingSizeG} > 0`,
    ),
    ...per100gChecks('log_entries', t),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// goals — effective-dated. The goal for a given day is the row with the
// greatest effective_date <= that day. "Update my goal" upserts today's row.
// ---------------------------------------------------------------------------

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    effectiveDate: date('effective_date').notNull(),
    kcalTarget: integer('kcal_target').notNull(),
    proteinTargetG: numeric('protein_target_g', { precision: 6, scale: 2 }),
    carbsTargetG: numeric('carbs_target_g', { precision: 6, scale: 2 }),
    fatTargetG: numeric('fat_target_g', { precision: 6, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('goals_user_effective_date_idx').on(t.userId, t.effectiveDate),
    check('goals_kcal_target_positive', sql`${t.kcalTarget} > 0`),
    check(
      'goals_macro_targets_non_negative',
      sql`(${t.proteinTargetG} IS NULL OR ${t.proteinTargetG} >= 0)
        AND (${t.carbsTargetG} IS NULL OR ${t.carbsTargetG} >= 0)
        AND (${t.fatTargetG} IS NULL OR ${t.fatTargetG} >= 0)`,
    ),
  ],
).enableRLS();
