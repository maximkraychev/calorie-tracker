import { Routes } from '@angular/router';

// Placeholder until the My Foods catalog is built (next pass).
const foodsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('../../shared/ui/coming-soon').then((m) => m.ComingSoon),
    data: { titleKey: 'nav.myFoods' },
  },
];

export default foodsRoutes;
