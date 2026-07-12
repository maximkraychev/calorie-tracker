import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import { env } from '../config/env.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MIN}m`)
    .sign(accessSecret);
}

/** Returns the userId (sub) or null if the token is invalid/expired. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, { algorithms: ['HS256'] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// Only the SHA-256 hash is persisted; the raw token lives solely in the cookie.
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
