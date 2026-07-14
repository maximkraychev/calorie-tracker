import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { AppError } from './api.config';

// Maps HttpErrorResponse onto the app's `{ status, message }` contract so callers
// get a stable shape. The backend sends `{ error: string }`; status 0 means the
// request never reached the server (offline / CORS / server down).
export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const serverMessage =
        err.error && typeof err.error.error === 'string' ? err.error.error : undefined;
      const message = serverMessage ?? (err.status === 0 ? 'Network error' : 'Request failed');
      const appError: AppError = { status: err.status, message };
      return throwError(() => appError);
    }),
  );
