import { randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { refreshTokens, users } from '../../db/schema.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../services/tokens.js';
import { AppError } from '../../utils/app-error.js';

// How auth works (ARCHITECTURE.md §5):
// - Passwords are stored as argon2id hashes, never plaintext.
// - A short-lived JWT (access token) proves identity on API calls.
// - A long-lived random string (refresh token) lets the client get a new JWT.
//   Only its SHA-256 hash is stored, so a DB leak can't be replayed.
// - Refresh tokens rotate on every use. All tokens from one login share a
//   family_id; if an already-used token shows up again, someone stole it —
//   we revoke the whole family and force a fresh login.

// argon2id cost parameters, OWASP recommended baseline.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface PublicUser {
  id: string;
  email: string;
}

interface AuthSession {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

// Postgres unique-violation is code 23505; Drizzle wraps the driver error,
// so walk the .cause chain to find it.
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { code?: unknown }).code === '23505') return true;
  return isUniqueViolation((err as { cause?: unknown }).cause);
}

// Creates the pair the client lives on: a signed JWT + a fresh refresh token
// (stored hashed, grouped under familyId for reuse detection).
async function issueSession(user: PublicUser, familyId: string): Promise<AuthSession> {
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = refreshTokenExpiry();

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    expiresAt: refreshTokenExpiresAt,
  });

  return { user, accessToken: await signAccessToken(user.id), refreshToken, refreshTokenExpiresAt };
}

// Revokes every still-active token in a rotation chain (logout / theft signal).
async function revokeFamily(familyId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function register(email: string, password: string): Promise<AuthSession> {
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

  // Insert and let the unique index on lower(email) decide — no pre-check,
  // so two simultaneous registrations can't race past each other.
  let user: PublicUser;
  try {
    const [inserted] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email });
    user = inserted!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('Email already registered', 409);
    }
    throw err;
  }

  // randomUUID() starts a brand-new token family for this login session.
  return issueSession(user, randomUUID());
}

export async function login(email: string, password: string): Promise<AuthSession> {
  // Opportunistic cleanup of expired refresh tokens — login is already a
  // slow path (argon2), so the extra DELETE is invisible here.
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date()));

  const [user] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);

  // Same 401 for unknown email and wrong password, so responses don't reveal
  // which emails have accounts (§4.1).
  if (!user || !(await argon2.verify(user.passwordHash, password))) {
    throw new AppError('Invalid email or password', 401);
  }

  return issueSession({ id: user.id, email: user.email }, randomUUID());
}

// Exchange a valid refresh token for a new access token + new refresh token.
export async function refresh(
  rawToken: string,
): Promise<{ accessToken: string; refreshToken: string; refreshTokenExpiresAt: Date }> {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)));

  // Unknown or expired token: nothing to rotate.
  if (!row || row.expiresAt < new Date()) {
    throw new AppError('Unauthorized', 401);
  }

  // Rotation: mark this token used (revoked) in one atomic UPDATE. If zero
  // rows come back it was already used — the theft signal — so revoke the
  // entire family and force a re-login.
  const claimed = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  if (claimed.length === 0) {
    await revokeFamily(row.familyId);
    throw new AppError('Unauthorized', 401);
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, row.userId));
  if (!user) {
    throw new AppError('Unauthorized', 401);
  }

  // Same familyId: the new token continues this login's rotation chain.
  return issueSession(user, row.familyId);
}

export async function logout(rawToken: string): Promise<void> {
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)));

  if (row) {
    await revokeFamily(row.familyId);
  }
}

export async function getMe(userId: string): Promise<PublicUser> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId));

  // Valid JWT but the account is gone (deleted) — treat as unauthenticated.
  if (!user) {
    throw new AppError('Unauthorized', 401);
  }
  return user;
}
