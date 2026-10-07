/**
 * env.ts — validated public config. The only module that reads `process.env.EXPO_PUBLIC_*`.
 *
 * Deps:  npx expo install zod
 *
 * Rules:
 * - Every EXPO_PUBLIC_* value is inlined into the JS bundle and is readable by anyone who
 *   downloads the app. Only identifiers and public keys belong here (Supabase URL + anon /
 *   publishable key, API base URL, Sentry DSN, feature flags).
 * - Expo inlines only static `process.env.EXPO_PUBLIC_X` member accesses, so each variable is
 *   listed explicitly below; `process.env[name]` would be undefined at runtime.
 * - In development the module throws if a public variable name looks like a secret.
 *
 * Adapt:
 * - Add/remove keys in both `Schema` and `raw`. Mark optional values `.optional()`.
 * - Server secrets go in the API's environment (EAS env / Vercel / `supabase secrets`), never here.
 */
import { z } from 'zod';

const Schema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url().optional(),
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20), // anon or sb_publishable_ key only
  EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  EXPO_PUBLIC_APP_ENV: z.enum(['development', 'preview', 'production']).default('development'),
});

const raw = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
};

const SECRET_NAME = /SECRET|PRIVATE|SERVICE|PASSWORD|PASSWD|ADMIN|SK_LIVE|SK_TEST|WEBHOOK|SIGNING|CLIENT_SECRET/i;

function assertNoSecretNames(names: string[]): void {
  const bad = names.filter((n) => SECRET_NAME.test(n));
  if (bad.length > 0) {
    throw new Error(
      `[env] Public variables look secret: ${bad.join(', ')}. EXPO_PUBLIC_* ships in the bundle; ` +
        'move these to the server and call an endpoint instead.',
    );
  }
}

function assertSafeValues(values: typeof raw): void {
  // A service-role JWT carries a "role" claim of service-role in its payload; never ship it.
  const key = values.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (/^sb_secret_/.test(key) || decodesToServiceRole(key)) {
    throw new Error('[env] EXPO_PUBLIC_SUPABASE_ANON_KEY is a service/secret key. Use the anon or publishable key.');
  }
  const url = values.EXPO_PUBLIC_API_URL;
  if (!__DEV__ && url && !url.startsWith('https://')) throw new Error('[env] EXPO_PUBLIC_API_URL must be https in release builds.');
}

function decodesToServiceRole(jwt: string): boolean {
  const payload = jwt.split('.')[1];
  if (!payload || typeof atob !== 'function') return false;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return /"role"\s*:\s*"service.role"/.test(atob(padded));
  } catch {
    return false;
  }
}

if (__DEV__) {
  // Best effort: catches variables present in the dev runtime env but not listed in `raw`.
  assertNoSecretNames(Object.keys(process.env).filter((k) => k.startsWith('EXPO_PUBLIC_')));
}
assertNoSecretNames(Object.keys(raw));
assertSafeValues(raw);

const parsed = Schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`[env] Invalid public config: ${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
