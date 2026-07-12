# Calorie Tracker — Monorepo Architecture

Full-stack calorie tracking app. This document covers the repo layout and the contracts
between the parts; each app has its own architecture doc for internals:

- [frontend/ARCHITECTURE.md](frontend/ARCHITECTURE.md) — Angular v22 SPA (standalone, signals, zoneless)
- [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) — Express 5 REST API (TypeScript, Drizzle, PostgreSQL)

## 1. Repo layout

```
calorie-tracker/
├── frontend/          # Angular SPA
├── backend/           # Express REST API
└── packages/
    └── shared/        # (planned) Shared TypeScript: DTOs, API contracts, validation schemas
```

`frontend/` and `backend/` are independent npm projects with their own `package.json`,
tooling, and build output. There is no workspace-level package manager setup yet; run
`npm install` in each app separately.

## 2. How the apps talk

- The backend serves everything under `/api` (e.g. `/api/health`, `/api/foods`).
- In development, the Angular dev server proxies `/api` → `http://localhost:3000`
  via `proxy.conf.json`, so the frontend never hardcodes a backend host and CORS
  is a non-issue locally.
- Error contract: the backend returns `{ error: string }` (plus `details` for
  validation failures); the frontend's `error.interceptor.ts` maps this shape to
  its `AppError` and user-facing toasts.

## 3. Shared contracts (`packages/shared`)

DTOs and validation schemas (Zod) that both sides need — `Food`, `DiaryEntry`,
`DailyGoal`, request/response types — should live in `packages/shared` and be imported
by both apps. Until that package exists, each app defines its own copies (frontend in
`features/*/models/`, backend in `modules/*/*.schema.ts`) and this doc's per-app
counterparts are the source of truth for shapes.

## 4. Domain overview

| Concept     | Purpose                                                        |
| ----------- | -------------------------------------------------------------- |
| FoodItem    | A food with **per-100g** nutrition — an Open Food Facts search/barcode result (not persisted) or a user's custom food (persisted) |
| DiaryEntry  | A snapshot logged in **grams** on a date, under a meal (breakfast/lunch/dinner/snack); nutrition copied in, never referenced |
| Recipe      | User's premade meal — built from ingredient snapshots or entered as manual totals; logged by grams, scaled proportionally |
| DailyGoal   | User's calorie & macro targets, effective-dated (each day judged by the goal active then) |
| Stats       | Aggregations of diary entries over date ranges                 |

Key invariants (details in [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md)): grams
are the source of truth for every quantity ("servings" is display-only, derived);
external food data is never cached — nutrition is snapshotted into rows at logging
time. The frontend calls Open Food Facts directly for search and barcode lookup;
only AI photo estimation goes through the backend.

## 5. Development

```
# terminal 1 — API on :3000
cd backend && npm run dev

# terminal 2 — SPA on :4200, proxying /api
cd frontend && npm start
```

Backend needs a PostgreSQL `DATABASE_URL` in `backend/.env` (see `backend/.env.example`) —
the Supabase session-pooler connection string in practice. Apply migrations with
`cd backend && npm run db:migrate`. Note: Supabase Storage is currently unused (meal
photos are transient by decision — sent to the AI estimator, never stored).
