import { Routes } from '@angular/router';

const recipesRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/my-recipes-page').then((m) => m.MyRecipesPage),
  },
];

export default recipesRoutes;
