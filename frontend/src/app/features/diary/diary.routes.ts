import { Routes } from '@angular/router';

const diaryRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/diary-page').then((m) => m.DiaryPage),
  },
];

export default diaryRoutes;
