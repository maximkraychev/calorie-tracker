# Backend Architecture — Calorie Tracker API

Express 5 + TypeScript (ESM, Node ≥22), Supabase Postgres via Drizzle ORM, Zod for
validation, pino for logging. Custom JWT auth — Supabase is Postgres only, accessed
server-side; there is no client-side Supabase session.

This document is the full design spec: schema, API contract, auth, and external
integrations. The schema is implemented (see `src/db/schema.ts` + `drizzle/`); routes
and services are specified here and not yet coded.

## 1. Core design decisions

1. **Snapshots, not foreign keys, for nutrition.** External food data (Open Food
   Facts search/barcode results, AI photo estimates) is never persisted as its own
   row. When the user logs an item or adds a recipe ingredient, its **per-100g**
   nutrition is copied into that row. `custom_food_id` / `recipe_id` / `external_id`
   columns are provenance only (`ON DELETE SET NULL`) — deleting a custom food or
   recipe never corrupts history.
2. **Grams are the source of truth** for every quantity. "Servings" is a display
   value derived at the API layer (`grams / servingSizeG`), never stored as primary.
3. **Custom foods are the only persisted catalog** (`custom_foods`), user-owned,
   searchable, and interchangeable with external results via the shared `FoodItem`
   shape (§7).
4. **Effective-dated goals.** A day's target is the latest `goals` row with
   `effective_date <= day`, so stats compare each day against the goal that was
   active then.
5. **Default-deny RLS.** Every table has RLS enabled with **no policies**. Only the
   backend's Postgres connection (table owner, bypasses RLS) can touch data; the
   Supabase PostgREST roles (`anon`, `authenticated`) are additionally stripped of
   all table privileges (migration `0001`).
6. **Photos are transient.** A meal photo is forwarded to the AI provider and never
   stored — no photo column, no Storage bucket. ⚠️ This means **Supabase Storage is
   currently unused** (flagged deviation: the original stack description included
   Storage; nothing needs it until photos become persistent).

## 2. Directory tree (target)

```
src/
├── server.ts                     # Entry point: createApp() + listen(env.PORT)
├── app.ts                        # Middleware, /api mount, error handling
│
├── config/
│   └── env.ts                    # Zod-validated env — the only reader of process.env
│
├── db/
│   ├── client.ts                 # Drizzle + postgres.js
│   └── schema.ts                 # All tables, enums, checks, indexes, RLS  ✅ implemented
│
├── middleware/
│   ├── error-handler.ts          # ZodError → 400 + details, AppError → status, else 500
│   ├── not-found.ts
│   └── require-auth.ts           # Verifies access JWT, attaches req.userId (§6)
│
├── modules/
│   ├── health/                   # ✅ implemented
│   ├── auth/                     #    register/login/refresh/logout/me
│   ├── foods/                    #    custom foods CRUD + search
│   ├── recipes/                  #    recipes + ingredients CRUD
│   ├── diary/                    #    log entries by date
│   ├── goals/                    #    effective-dated targets
│   ├── stats/                    #    period summaries
│   └── estimates/                #    POST photo → AI estimate (no persistence)
│       └── ... each: *.router.ts / *.controller.ts / *.service.ts / *.schema.ts
│
├── services/                     # Cross-module / external integrations
│   ├── photo-estimate.ts         # Provider-agnostic AI photo estimation (§7)
│   └── tokens.ts                 # JWT sign/verify + refresh-token helpers (§6)
│
├── routes/
│   └── index.ts                  # apiRouter: one mount line per module
│
└── utils/
    ├── app-error.ts
    ├── logger.ts
    └── nutrition.ts              # per-100g ↔ totals math (mirror of frontend utils)
```

Request flow per module: `router` (Zod-validates params/query/body) → `controller`
(req/res only) → `service` (business rules + Drizzle; throws `AppError`). Express 5
forwards thrown async errors to `error-handler.ts` natively. Error contract:
`{ error: string, details? }` — matches the frontend's `error.interceptor.ts`.

## 3. Database schema

Implemented in `src/db/schema.ts`; migrations in `drizzle/`
(`0000_init_schema.sql` — generated, plus `pg_trgm`; `0001_views_triggers_hardening.sql`
— hand-written: `updated_at` triggers, views, role revokes).

### Tables

| Table                | Purpose                                                        | Key columns |
| -------------------- | -------------------------------------------------------------- | ----------- |
| `users`              | Accounts                                                       | `email` (unique on `lower(email)`), `password_hash` |
| `refresh_tokens`     | Rotated refresh tokens, hashed                                 | `token_hash` (unique, SHA-256), `family_id`, `expires_at`, `revoked_at` |
| `custom_foods`       | User-created foods (the only food catalog)                     | `name`, `brand`, per-100g macros, `serving_size_g?` |
| `recipes`            | Two modes: `ingredients` (computed) / `manual` (flat totals)   | `nutrition_mode`, `total_weight_g?`, `*_total` (manual only, CHECK-enforced) |
| `recipe_ingredients` | Snapshot rows for `ingredients`-mode recipes                   | `grams`, per-100g snapshot, `source`, provenance ids, `position` |
| `log_entries`        | The diary: one row per logged item                             | `entry_date`, `meal`, `grams`, per-100g snapshot, **generated** `kcal`/`protein_g`/`carbs_g`/`fat_g` |
| `goals`              | Effective-dated targets                                        | `effective_date` (unique per user), `kcal_target`, optional macro targets |

Enums: `meal_type` (breakfast/lunch/dinner/snack), `food_source`
(search/barcode/ai/recipe/custom/manual), `recipe_nutrition_mode`
(ingredients/manual).

### Integrity rules (CHECK constraints)

- `grams > 0` everywhere; `serving_size_g > 0` when present; names non-blank.
- Per-100g sanity: `kcal ∈ [0, 900]`, each macro `∈ [0, 100]` g. Intentionally
  strict — it rejects garbage OFF data at the boundary; the API should pre-validate
  with the same Zod ranges to return a 400 instead of a 500.
- `recipes_mode_shape`: `manual` ⇒ all four totals present (≥ 0) **and**
  `total_weight_g` present; `ingredients` ⇒ all totals NULL.
  ("`ingredients`-mode recipes have ingredient rows, `manual` ones don't" is
  API-enforced — CHECKs can't cross tables.)
- Effective-dated goals: `UNIQUE (user_id, effective_date)`.

### Derived data

- `log_entries.kcal/protein_g/carbs_g/fat_g` are **stored generated columns**
  (`round(grams * per_100g / 100, 2)`), so all aggregation is a plain `SUM`.
- View `daily_totals`: per user/day sums + entry count.
- View `daily_summary`: `daily_totals` + `LEFT JOIN LATERAL` the goal effective on
  that date. Both views are `security_invoker = on` so they can't become an RLS
  bypass for non-owner roles.

### Indexes for the app's query patterns

- Diary/stats: `log_entries (user_id, entry_date)`.
- Ownership scans: `custom_foods (user_id)`, `recipes (user_id)`,
  `refresh_tokens (user_id)`, `(family_id)`.
- Name search: GIN `gin_trgm_ops` on `custom_foods.name` and `recipes.name`
  (extension `pg_trgm`, created in migration 0000) — serves `ILIKE '%q%'`.
- Provenance FKs (`custom_food_id`, `recipe_id`) indexed so `ON DELETE SET NULL`
  doesn't full-scan.

### Supabase specifics

- The backend connects over the Postgres protocol (Drizzle + postgres.js), not
  supabase-js — the "service role" equivalent is the **database connection string**
  in `DATABASE_URL`. Use the **session pooler** URI (port 5432); if the transaction
  pooler (6543) is ever used, postgres.js needs `prepare: false`.
- Default-deny RLS + the `anon`/`authenticated` revokes in migration 0001 close the
  PostgREST/Data-API surface. The revoke block is guarded by role existence so the
  same migrations run on plain Postgres in dev/CI.
- Apply with `npm run db:migrate` once `DATABASE_URL` points at the Supabase project.

## 4. API contract

All routes are under `/api`. Everything except `auth/*` and `health` requires
`Authorization: Bearer <accessToken>` and is scoped to `req.userId` — a row's
`user_id` must match or the API responds 404 (not 403, to avoid existence leaks).
Dates are date-only ISO strings (`"2026-07-11"`). Nutrition numbers are plain JSON
numbers (numeric columns serialized via `parseFloat` at the service layer).

### 4.1 `auth` → frontend `auth.api.ts`

| Method | Path                 | Request                 | Response                                | Touches |
| ------ | -------------------- | ----------------------- | --------------------------------------- | ------- |
| POST   | `/api/auth/register` | `{ email, password }`   | `201 { user: {id, email}, accessToken }` + refresh cookie | `users`, `refresh_tokens` |
| POST   | `/api/auth/login`    | `{ email, password }`   | `200` same shape + refresh cookie       | `users`, `refresh_tokens` |
| POST   | `/api/auth/refresh`  | — (refresh cookie)      | `200 { accessToken }` + rotated cookie  | `refresh_tokens` |
| POST   | `/api/auth/logout`   | — (refresh cookie)      | `204` + cleared cookie                  | `refresh_tokens` (revoke family) |
| GET    | `/api/auth/me`       | — (Bearer)              | `200 { user: {id, email} }`             | `users` |

Password rules: Zod `min(8)`, `max(72)`. Duplicate email → `409`.
Bad credentials → `401` with the same message for unknown-email and wrong-password.

### 4.2 `foods` (custom foods only) → frontend `foods.api.ts`

External search/barcode results never appear here — the frontend queries Open Food
Facts directly (§7) and merges results client-side with this endpoint's output.

| Method | Path                  | Request                                          | Response            | Touches |
| ------ | --------------------- | ------------------------------------------------ | ------------------- | ------- |
| GET    | `/api/foods?q=`       | `q` optional (trgm ILIKE), else all              | `200 FoodItem[]` (all `source: 'custom'`) | `custom_foods` |
| POST   | `/api/foods`          | `{ name, brand?, per100g, servingSizeG? }`       | `201 FoodItem`      | `custom_foods` |
| GET    | `/api/foods/:id`      | —                                                | `200 FoodItem`      | `custom_foods` |
| PUT    | `/api/foods/:id`      | same as POST                                     | `200 FoodItem`      | `custom_foods` |
| DELETE | `/api/foods/:id`      | —                                                | `204` (log entries keep their snapshot; FK → NULL) | `custom_foods` |

### 4.3 `recipes` → frontend `recipes.api.ts` (new feature, mirrors `foods`)

| Method | Path                 | Request                                     | Response          | Touches |
| ------ | -------------------- | ------------------------------------------- | ----------------- | ------- |
| GET    | `/api/recipes?q=`    | `q` optional                                | `200 Recipe[]` (no ingredient arrays) | `recipes` (+ ingredient sums) |
| POST   | `/api/recipes`       | `NewRecipe` (below)                         | `201 Recipe` (with `ingredients`) | `recipes`, `recipe_ingredients` (tx) |
| GET    | `/api/recipes/:id`   | —                                           | `200 Recipe` (with `ingredients`) | both |
| PUT    | `/api/recipes/:id`   | `NewRecipe` — ingredients replaced wholesale | `200 Recipe`     | both (tx: delete + insert) |
| DELETE | `/api/recipes/:id`   | —                                           | `204` (diary keeps snapshots)     | `recipes` |

```ts
type NewRecipe =
  | { name: string; mode: 'ingredients'; totalWeightG?: number;   // default: sum of ingredient grams (override for cooked weight)
      ingredients: Array<{ name: string; brand?: string;
        source: 'search' | 'barcode' | 'custom' | 'manual';
        customFoodId?: string; externalId?: string;
        grams: number; per100g: Per100g }> }                       // per100g server-resolved when source = 'custom'
  | { name: string; mode: 'manual'; totalWeightG: number;
      totals: { kcal: number; protein: number; carbs: number; fat: number } };

interface Recipe {
  id: string; name: string; mode: 'ingredients' | 'manual';
  totalWeightG: number;              // explicit or computed sum
  per100g: Per100g;                  // totals / totalWeightG * 100 — this is what logging snapshots
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  ingredients?: RecipeIngredient[];  // detail responses, ingredients mode only
}
```

### 4.4 `diary` → frontend `diary.api.ts`

| Method | Path                      | Request                                   | Response | Touches |
| ------ | ------------------------- | ----------------------------------------- | -------- | ------- |
| GET    | `/api/diary?date=`        | required `date`                           | `200 { date, goal: DailyGoal \| null, totals: Totals, entries: DiaryEntry[] }` | `log_entries`, `goals` |
| POST   | `/api/diary/entries`      | `{ date, meal, items: NewEntryItem[] }` (batch — the multi-add search flow posts once) | `201 DiaryEntry[]` | `log_entries` (+ `custom_foods`/`recipes` reads) |
| PATCH  | `/api/diary/entries/:id`  | `{ grams?, meal?, date? }`                | `200 DiaryEntry` | `log_entries` |
| DELETE | `/api/diary/entries/:id`  | —                                         | `204`    | `log_entries` |

```ts
interface NewEntryItem {
  source: 'search' | 'barcode' | 'ai' | 'recipe' | 'custom' | 'manual';
  name?: string; brand?: string;      // required unless server-resolved (below)
  grams: number;
  per100g?: Per100g;                  // required for search/barcode/ai/manual
  servingSizeG?: number;
  customFoodId?: string;              // source 'custom': server copies name/brand/per100g/servingSizeG
  recipeId?: string;                  // source 'recipe': server computes per100g from the recipe
  externalId?: string;                // OFF product code, provenance only
}

interface DiaryEntry {
  id: string; date: string; meal: MealType;
  name: string; brand: string | null; source: FoodSource;
  grams: number; per100g: Per100g; servingSizeG: number | null;
  servings: number | null;            // derived: grams / servingSizeG
  kcal: number; proteinG: number; carbsG: number; fatG: number;  // generated columns
  customFoodId: string | null; recipeId: string | null; externalId: string | null;
}
```

Trust boundary: for `custom` and `recipe` sources the **server** resolves the
snapshot (client-sent nutrition is ignored) — client math is never trusted where a
server-side source of truth exists. External sources (`search`/`barcode`/`ai`/
`manual`) necessarily carry client-supplied nutrition; Zod enforces the same ranges
as the DB CHECKs.

### 4.5 `goals` → frontend `goals.api.ts`

| Method | Path                  | Request                                                  | Response | Touches |
| ------ | --------------------- | -------------------------------------------------------- | -------- | ------- |
| GET    | `/api/goals/current`  | —                                                        | `200 DailyGoal \| null` (effective today) | `goals` |
| PUT    | `/api/goals`          | `{ kcalTarget, proteinTargetG?, carbsTargetG?, fatTargetG? }` | `200 DailyGoal` (upsert `effective_date = today`) | `goals` |

```ts
interface DailyGoal {
  effectiveDate: string;
  kcalTarget: number;
  proteinTargetG: number | null; carbsTargetG: number | null; fatTargetG: number | null;
}
```

Editing the goal twice in one day overwrites today's row (`ON CONFLICT (user_id,
effective_date) DO UPDATE`); past days keep the goal they had.

### 4.6 `stats` → frontend `stats.api.ts`

| Method | Path                       | Request                        | Response | Touches |
| ------ | -------------------------- | ------------------------------ | -------- | ------- |
| GET    | `/api/stats?from=&to=`     | required range (Zod: `from <= to`, ≤ 366 days) | `200 DailySummary[]` — one element **per calendar day** (empty days: zero totals, `entryCount: 0`, goal still resolved) | `daily_summary` view + `generate_series` |

```ts
interface DailySummary {
  date: string; entryCount: number;
  kcal: number; proteinG: number; carbsG: number; fatG: number;
  goal: DailyGoal | null;             // the goal effective on that date
}
```

### 4.7 `estimates` → frontend `diary.api.ts` (`estimatePhoto()`)

| Method | Path                    | Request                                | Response | Touches |
| ------ | ----------------------- | -------------------------------------- | -------- | ------- |
| POST   | `/api/estimates/photo`  | `multipart/form-data`, field `photo` (jpeg/png/webp, ≤ 10 MB) | `200 { items: PhotoEstimateItem[] }` | `services/photo-estimate` only — **nothing persisted** |

The user edits the returned items in the UI, then confirms → frontend posts them as
normal diary items with `source: 'ai'`. The photo is gone after this request.

## 5. Auth implementation plan

- **Password hashing**: `argon2` (argon2id), OWASP baseline: `memoryCost 19456`,
  `timeCost 2`, `parallelism 1`. Hash comparison via the library (constant-time).
- **Access token**: JWT (HS256 via `jose`), TTL **15 min**, payload `{ sub: userId }`
  only. Secret: `JWT_ACCESS_SECRET` (≥ 32 chars, added to `env.ts` schema).
- **Refresh token**: 32 random bytes (base64url), **stored as SHA-256 hash** in
  `refresh_tokens`, TTL **30 days**. Delivered as an `httpOnly` cookie:
  `Secure` (prod), `SameSite=Lax`, `Path=/api/auth` (sent only to auth endpoints).
  Requires `cookie-parser`.
- **Rotation & reuse detection**: every `/refresh` revokes the presented token
  (`revoked_at = now()`) and inserts a new one with the **same `family_id`**.
  Presenting a token that is already revoked ⇒ theft signal ⇒ revoke the entire
  family, 401. Logout revokes the family and clears the cookie. Expired rows are
  garbage-collected opportunistically (`DELETE ... WHERE expires_at < now()` on a
  slow path or a cron later).
- **Middleware** `require-auth.ts`: parse `Authorization: Bearer`, `jose.jwtVerify`,
  set `req.userId = payload.sub` (Express `Request` augmented via a `.d.ts`);
  missing/invalid ⇒ `401 { error: 'Unauthorized' }`. Applied per-router — every
  module except `auth` and `health`.
- **New env vars**: `JWT_ACCESS_SECRET`, optional `ACCESS_TOKEN_TTL_MIN` (15),
  `REFRESH_TOKEN_TTL_DAYS` (30). Update `.env.example` when implementing.
- **New deps when implementing**: `argon2`, `jose`, `cookie-parser`, `multer`
  (photo upload).

## 6. External integrations & the normalized food shape

The single shape that makes search results, barcode hits, and custom foods
interchangeable everywhere (frontend UI, `NewEntryItem`, recipe ingredients):

```ts
interface Per100g { kcal: number; protein: number; carbs: number; fat: number }

interface FoodItem {
  source: 'search' | 'barcode' | 'custom';
  id: string | null;           // custom_foods.id when source = 'custom', else null
  externalId: string | null;   // OFF product code when external, else null
  name: string;
  brand: string | null;
  per100g: Per100g;
  servingSizeG: number | null;
}
```

### `foodSearch` / `barcodeLookup` — frontend-side (⚠️ by binding decision)

Per the binding decision, the frontend calls Open Food Facts **directly** (debounced
search; barcode product lookup). Consequence — flagged: these two normalizers cannot
be backend functions; they live in the frontend (suggested:
`features/foods/data/off.api.ts`) and normalize OFF responses into `FoodItem`:

```ts
foodSearch(query: string): Promise<FoodItem[]>     // GET .../cgi/search.pl?search_terms=…&json=1
barcodeLookup(barcode: string): Promise<FoodItem | null>  // GET .../api/v2/product/{barcode}.json; null → manual-entry fallback
```

Normalization rules: `energy-kcal_100g` etc. from `product.nutriments`; skip results
missing kcal-per-100g; `serving_quantity` → `servingSizeG` when in grams. The
backend's Zod ranges (§4.4) are the safety net for whatever OFF returns.

### `photoEstimate` — backend-side, provider-abstracted

Backend-only because the AI provider key is a secret. One interface, provider chosen
by env (`PHOTO_AI_PROVIDER`, default `stub`); swapping providers touches nothing but
a new adapter in `services/photo-estimate.ts` — not routes, schema, or the frontend
contract:

```ts
interface PhotoEstimateItem {
  name: string;
  estimatedGrams: number;      // user-editable before logging
  per100g: Per100g;
  confidence: number | null;   // 0..1 if the provider reports it
}

interface PhotoEstimateProvider {
  estimate(image: { data: Buffer; mimeType: string }): Promise<PhotoEstimateItem[]>;
}
```

Providers must normalize to per-100g: if a provider returns absolute per-item
calories, the adapter converts (`per100g.kcal = itemKcal / estimatedGrams * 100`).

## 7. Frontend model impact (flagged changes)

The frontend's `ARCHITECTURE.md` §3 models predate this design and need these
adjustments:

1. **`Food` → `FoodItem`**: nutrition changes from **per-serving to per-100g**;
   `servingSize` → optional `servingSizeG`; add `source` and `externalId`;
   `isCustom` becomes `source === 'custom'`; `id` becomes nullable (external
   results have no row).
2. **`DiaryEntry`**: `servings` is no longer stored — **`grams` is the value the
   form collects and submits**; `servings` remains only as an API-derived display
   convenience. `foodId: string` + `food: Food` are replaced by an embedded
   snapshot (`name`, `brand`, `per100g`, `servingSizeG`) plus nullable provenance
   ids (`customFoodId`, `recipeId`, `externalId`). Derived totals (`kcal`,
   `proteinG`, `carbsG`, `fatG`) arrive precomputed. The `entry-form` component's
   "servings" input becomes a grams input.
3. **`DailyGoal`**: gains `effectiveDate`; macro targets become nullable (backend
   allows kcal-only goals). `goals.api.ts` uses `GET /goals/current` + `PUT /goals`.
4. **New models/features**: `Recipe`, `RecipeIngredient`, `PhotoEstimateItem`;
   a new `features/recipes/` mirroring the `foods` feature structure; OFF access
   lives in a frontend `off.api.ts`; `diary.api.ts` gains `estimatePhoto()`.
5. **`nutrition.utils.ts`** should center on per-100g math (`totals = grams *
   per100g / 100`) so client-side previews match the backend's generated columns.

## 8. Configuration & logging

- `config/env.ts` is the only reader of `process.env` (Zod, exits on invalid).
  Grows with §5's auth vars and later the AI provider key.
- pino everywhere; `pino-http` per request. Never log passwords, tokens, or photo
  bytes.

## 9. Implementation order

1. ✅ Schema + migrations (`drizzle/0000`, `0001`) — run `npm run db:migrate`
   against Supabase.
2. `modules/auth` + `require-auth` middleware + `services/tokens.ts` (§5).
3. `modules/foods` (custom foods CRUD/search) — smallest authed module, proves the
   pattern.
4. `modules/diary` (batch add, server-resolved snapshots) + `modules/goals`.
5. `modules/recipes` (transactional ingredient replace), then diary's
   `source: 'recipe'` resolution.
6. `modules/stats` over `daily_summary` + `generate_series`.
7. `modules/estimates` + `services/photo-estimate.ts` with the `stub` provider.
