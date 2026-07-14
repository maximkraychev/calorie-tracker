import type { Request, Response } from 'express';

import { env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';
import { credentialsSchema } from './auth.schema.js';
import * as authService from './auth.service.js';

const REFRESH_COOKIE = 'refreshToken';

// Path-scoped to /api/auth so the cookie is only sent to auth endpoints (§5).
// In production the frontend and API live on different domains, so the cookie
// is cross-site: it must be sameSite: 'none' (and therefore secure) or the
// browser drops it. Dev is same-origin via the proxy, so 'lax' works there.
const isProduction = env.NODE_ENV === 'production';
const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/api/auth',
} as const;

function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions, expires });
}

function readRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown>)[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function register(req: Request, res: Response) {
  const { email, password } = credentialsSchema.parse(req.body);
  const session = await authService.register(email, password);
  setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
  res.status(201).json({ user: session.user, accessToken: session.accessToken });
}

export async function login(req: Request, res: Response) {
  const { email, password } = credentialsSchema.parse(req.body);
  const session = await authService.login(email, password);
  setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
  res.json({ user: session.user, accessToken: session.accessToken });
}

export async function refresh(req: Request, res: Response) {
  const token = readRefreshCookie(req);
  if (!token) {
    throw new AppError('Unauthorized', 401);
  }
  const session = await authService.refresh(token);
  setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
  res.json({ accessToken: session.accessToken });
}

export async function logout(req: Request, res: Response) {
  const token = readRefreshCookie(req);
  if (token) {
    await authService.logout(token);
  }
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = await authService.getMe(req.userId!);
  res.json({ user });
}
