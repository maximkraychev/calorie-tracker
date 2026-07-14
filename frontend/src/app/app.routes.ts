import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { Shell } from './core/layout/shell';

export const routes: Routes = [
  // Authenticated app: the shell (tabs + top bar) wraps the feature tabs.
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'diary', pathMatch: 'full' },
      { path: 'diary', loadChildren: () => import('./features/diary/diary.routes') },
      { path: 'foods', loadChildren: () => import('./features/foods/foods.routes') },
      { path: 'recipes', loadChildren: () => import('./features/recipes/recipes.routes') },
    ],
  },
  // Public auth pages (/login, /register, /forgot).
  { path: '', loadChildren: () => import('./features/auth/auth.routes') },
  { path: '**', redirectTo: '' },
];
