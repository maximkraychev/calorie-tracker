import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Root component: the app is a mobile-sized single column. Everything else
// (shell, tabs, sheets) is rendered through the router.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styleUrl: './app.scss',
})
export class App {}
