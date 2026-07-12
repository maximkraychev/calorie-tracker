# Frontend Architecture — Calorie Tracker

Angular v22, standalone components, signals-first, zoneless. This document is the
scaffolding blueprint: folder layout, naming, and the patterns every feature follows.
For the repo-wide picture and the API contract, see [../ARCHITECTURE.md](../ARCHITECTURE.md);
the backend counterpart is [../backend/ARCHITECTURE.md](../backend/ARCHITECTURE.md).

## 1. High-level structure

Three layers under `src/app/`:

| Layer      | Purpose                                                                 | May import from        |
| ---------- | ----------------------------------------------------------------------- | ----------------------- |
| `core/`    | App-wide singletons: layout shell, interceptors, guards, config, auth   | `shared/`               |
| `shared/`  | Reusable, stateless building blocks: UI components, pipes, directives   | nothing app-specific    |
| `features/`| One folder per business capability, lazy-loaded via routes              | `core/`, `shared/`      |

Features never import from each other. Anything two features need moves to `shared/`
(presentational) or `core/` (stateful/singleton).

## 2. Directory tree

```
src/app/
├── app.ts                        # Root component (router-outlet + shell)
├── app.html
├── app.scss
├── app.config.ts                 # Providers: router, http, error listeners
├── app.routes.ts                 # Top-level routes, lazy-loads features
│
├── core/
│   ├── api/
│   │   ├── api.config.ts         # API_BASE_URL injection token
│   │   ├── auth.interceptor.ts   # Attach access token
│   │   └── error.interceptor.ts  # Map HTTP errors → AppError, toast on 5xx
│   ├── auth/
│   │   ├── auth.store.ts         # Session state (signals): user, isAuthenticated
│   │   ├── auth.api.ts           # login / register / logout / refresh calls
│   │   └── auth.guard.ts         # CanActivate for protected routes
│   ├── layout/
│   │   ├── shell.ts              # App shell: header + nav + <router-outlet>
│   │   ├── header.ts
│   │   └── nav.ts                # Bottom nav (mobile) / sidebar (desktop)
│   └── notifications/
│       └── toast.store.ts        # Global toast/snackbar queue (signals)
│
├── shared/
│   ├── ui/                       # Dumb, reusable components (inline templates)
│   │   ├── button.ts
│   │   ├── card.ts
│   │   ├── progress-ring.ts      # Calories-remaining ring
│   │   ├── macro-bar.ts          # Protein/carbs/fat bar
│   │   ├── empty-state.ts
│   │   ├── spinner.ts
│   │   └── dialog.ts
│   ├── pipes/
│   │   ├── kcal.pipe.ts          # 1234 → "1,234 kcal"
│   │   └── grams.pipe.ts
│   ├── directives/
│   └── utils/
│       ├── date.utils.ts         # ISO date-only helpers ("2026-07-06")
│       └── nutrition.utils.ts    # Pure macro/calorie math
│
└── features/
    ├── dashboard/                # "/": today at a glance
    │   ├── dashboard.routes.ts
    │   └── pages/
    │       └── dashboard-page.ts # Composes progress-ring, macro-bar, meal summaries
    │
    ├── diary/                    # "/diary/:date": the daily food log (core feature)
    │   ├── diary.routes.ts
    │   ├── data/
    │   │   ├── diary.api.ts      # CRUD /api/diary?date=
    │   │   └── diary.store.ts    # Entries for selected date + computed totals
    │   ├── models/
    │   │   └── diary-entry.model.ts
    │   ├── pages/
    │   │   └── diary-page.ts     # Date picker + meal sections
    │   └── components/
    │       ├── meal-section.ts   # Breakfast / lunch / dinner / snacks group
    │       ├── entry-row.ts
    │       └── entry-form.ts     # Signal Form: servings, meal type
    │
    ├── foods/                    # "/foods": food catalog & search
    │   ├── foods.routes.ts
    │   ├── data/
    │   │   ├── foods.api.ts      # Search + CRUD /api/foods
    │   │   └── foods.store.ts
    │   ├── models/
    │   │   └── food.model.ts
    │   ├── pages/
    │   │   ├── food-search-page.ts   # Search + "add to diary" entry point
    │   │   └── food-detail-page.ts
    │   └── components/
    │       ├── food-list-item.ts
    │       └── food-form.ts      # Signal Form: create custom food
    │
    ├── goals/                    # "/goals": calorie & macro targets
    │   ├── goals.routes.ts
    │   ├── data/
    │   │   ├── goals.api.ts
    │   │   └── goals.store.ts
    │   ├── models/
    │   │   └── goal.model.ts
    │   └── pages/
    │       └── goals-page.ts     # Signal Form: daily kcal + macro split
    │
    ├── stats/                    # "/stats": trends over time
    │   ├── stats.routes.ts
    │   ├── data/
    │   │   └── stats.api.ts      # GET /api/stats?from=&to=
    │   └── pages/
    │       └── stats-page.ts     # Weekly/monthly charts
    │
    └── auth/                     # "/login", "/register" (public)
        ├── auth.routes.ts
        └── pages/
            ├── login-page.ts     # Signal Form
            └── register-page.ts
```

Naming follows the Angular v20+ style guide: no `.component`/`.service` suffixes on
components and stores; role suffixes only where they disambiguate (`.api.ts`,
`.store.ts`, `.routes.ts`, `.guard.ts`, `.interceptor.ts`, `.pipe.ts`, `.model.ts`).
Tests sit next to their subject as `*.spec.ts` (Vitest).

## 3. Domain model

Shared API contracts (DTOs) should eventually live in `packages/shared` and be imported
by both frontend and backend. Until then, define them in each feature's `models/`.

```ts
// food.model.ts — nutrition is always per 100g/100ml or per named serving
export interface Food {
  id: string;
  name: string;
  brand?: string;
  servingSize: number;        // grams per 1 serving
  kcal: number;               // per serving
  protein: number;            // g per serving
  carbs: number;
  fat: number;
  isCustom: boolean;          // user-created vs. catalog
}

// diary-entry.model.ts
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface DiaryEntry {
  id: string;
  date: string;               // date-only ISO: "2026-07-06"
  meal: MealType;
  foodId: string;
  food: Food;                 // denormalized for display
  servings: number;
}

// goal.model.ts
export interface DailyGoal {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
```

## 4. Routing

Top-level routes lazy-load each feature's route file; the authenticated area is wrapped
in the shell layout and guard:

```ts
// app.routes.ts
export const routes: Routes = [
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', loadChildren: () => import('./features/dashboard/dashboard.routes') },
      { path: 'diary', loadChildren: () => import('./features/diary/diary.routes') },
      { path: 'foods', loadChildren: () => import('./features/foods/foods.routes') },
      { path: 'goals', loadChildren: () => import('./features/goals/goals.routes') },
      { path: 'stats', loadChildren: () => import('./features/stats/stats.routes') },
    ],
  },
  { path: '', loadChildren: () => import('./features/auth/auth.routes') }, // /login, /register
  { path: '**', redirectTo: '' },
];
```

Each `*.routes.ts` default-exports its `Routes` array. Route params bind to component
inputs via `withComponentInputBinding()` (e.g. `diary/:date` → `date = input<string>()`).

## 5. State management pattern

One **store per feature**, a plain root-provided service built on signals — no NgRx.

- Private writable signals hold raw state; public API exposes `readonly` signals and `computed()`.
- Stores call their feature's `*.api.ts` service (thin `HttpClient` wrappers returning observables or `httpResource`).
- Components read signals in templates and call store methods on events. Pages (smart) talk to stores; `components/` and `shared/ui` stay presentational (`input()`/`output()` only).

```ts
// diary.store.ts (shape, not full code)
@Service()
export class DiaryStore {
  private readonly api = inject(DiaryApi);

  private readonly _date = signal(todayIso());
  private readonly _entries = signal<DiaryEntry[]>([]);
  private readonly _loading = signal(false);

  readonly date = this._date.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly byMeal = computed(() => groupBy(this._entries(), (e) => e.meal));
  readonly totals = computed(() => sumNutrition(this._entries()));

  selectDate(date: string): void { /* set date, reload */ }
  addEntry(input: NewDiaryEntry): void { /* optimistic update + api call */ }
  removeEntry(id: string): void { /* ... */ }
}
```

Cross-feature derived state (e.g. dashboard's "calories remaining") is computed in the
consuming page from `DiaryStore.totals` + `GoalsStore.goal` — stores stay independent.

## 6. Data access & app config

`app.config.ts` grows to:

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    { provide: API_BASE_URL, useValue: '/api' }, // dev proxy → backend (proxy.conf.json)
  ],
};
```

- All HTTP goes through `*.api.ts` services using `API_BASE_URL`; components never inject `HttpClient`.
- `error.interceptor.ts` normalizes backend errors (matches backend's `AppError` shape) and pushes user-facing failures to `ToastStore`.
- Dev server proxies `/api` to the Express backend via `proxy.conf.json` — no CORS, no hardcoded hosts.

## 7. Forms & validation

Signal Forms (`@angular/forms/signals`) everywhere: `entry-form`, `food-form`,
`goals-page`, `login-page`, `register-page`. Schema-based validation with typed field
access; numeric nutrition fields validate `min(0)`, goals validate that macro kcal sum
matches the calorie target (warning, not error).

## 8. Testing

- Vitest + jsdom (already configured).
- Stores and `shared/utils` get the densest coverage — nutrition math and date logic are pure functions, test them exhaustively.
- `*.api.ts` tested with `provideHttpClientTesting`.
- Component tests focus on pages (rendering per store state) and forms (validation).

## 9. Scaffolding order

1. `core/` — API token, interceptors, toast store, shell/layout; wire `app.config.ts` + proxy.
2. `shared/` — ui primitives, pipes, `nutrition.utils` + `date.utils` (with tests).
3. `features/foods` — models, api, store, search page (diary depends on it).
4. `features/diary` — the core loop: log food, see totals.
5. `features/goals`, then `features/dashboard` (composes diary + goals).
6. `features/stats`.
7. `core/auth` + `features/auth` last, once the backend has auth endpoints; until then `authGuard` returns `true`.
