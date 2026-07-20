import { Service, signal } from '@angular/core';

// App-level open/closed state for the account sheet. The trigger (the account icon button)
// now lives on the diary's day-switcher row, while the sheet itself is still rendered by the
// Shell — this shared signal lets the two coordinate across the router outlet.
@Service()
export class AccountSheet {
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  show(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
