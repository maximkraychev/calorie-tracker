import { Routes } from '@angular/router';

const foodsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/my-foods-page').then((m) => m.MyFoodsPage),
  },
];

export default foodsRoutes;
