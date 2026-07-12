---
name: verify
description: Build, launch, and drive the calorie-tracker Express API to verify changes at the HTTP surface.
---

# Verifying the backend

Surface: HTTP API on `/api/*`. Drive it with curl; use `-c/-b cookiejar` for the
httpOnly refresh cookie flows.

## Launch

```bash
cd backend
JWT_ACCESS_SECRET=<any-32+-char-string> PORT=3987 npx tsx src/server.ts   # run in background
curl -s http://localhost:3987/api/health   # readiness: {"status":"up",...}
```

- `DATABASE_URL` comes from `backend/.env` (real dev Supabase DB — clean up any
  rows you create). Env vars set in the shell win over `.env` (dotenv doesn't
  override), so inject test secrets/ports that way.
- Use a non-default port (e.g. 3987) to avoid colliding with the user's dev server.

## Gotchas

- **Windows: TaskStop leaves the node child alive and listening.** After stopping
  the background task, find and kill it or the old code keeps serving:
  `netstat -ano | grep :3987 | grep LISTEN` → `taskkill //F //PID <pid>`.
- Plain `npx tsx` does NOT hot-reload; restart (and kill the orphan) after edits,
  or launch with `npx tsx watch`.
- One-off DB scripts must live inside `backend/` (relative imports + tsx), e.g.
  write `backend/cleanup.local.mts`, run with `npx tsx`, then delete it.

## Auth flows worth driving

Register/login return `{ user, accessToken }` + `refreshToken` cookie
(Path=/api/auth). `/api/auth/refresh` rotates the cookie; replaying an old
cookie must 401 AND kill the current one (family revocation). `/api/auth/me`
needs `Authorization: Bearer <accessToken>`.
