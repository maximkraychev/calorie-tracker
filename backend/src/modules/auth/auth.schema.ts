import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.email().max(254),
  // 72-char cap: keeps parity with common bcrypt-era clients; argon2 has no such limit.
  password: z.string().min(8).max(72),
});

export type Credentials = z.infer<typeof credentialsSchema>;
