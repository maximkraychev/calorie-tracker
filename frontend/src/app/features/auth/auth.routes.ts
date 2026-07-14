import { Routes } from '@angular/router';

import { guestGuard } from '../../core/auth/auth.guard';

// Public auth pages. guestGuard keeps already-authenticated users out.
const authRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register-page').then((m) => m.RegisterPage),
  },
  {
    path: 'forgot',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/forgot-page').then((m) => m.ForgotPage),
  },
];

export default authRoutes;
