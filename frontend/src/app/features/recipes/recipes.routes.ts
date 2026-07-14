import { Routes } from '@angular/router';

// Placeholder until the My Recipes feature is built (next pass).
const recipesRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('../../shared/ui/coming-soon').then((m) => m.ComingSoon),
    data: { titleKey: 'nav.recipes' },
  },
];

export default recipesRoutes;
