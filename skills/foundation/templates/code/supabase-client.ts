/**
 * supabase-client.ts — the app's single Supabase client.
 *
 * Deps:  npx expo install @supabase/supabase-js expo-secure-store react-native-url-polyfill
 *        Generate types: npx supabase gen types typescript --project-id <id> > lib/database.types.ts
 *
 * Rules:
 * - Only the anon / publishable key ships in the app. Never the service-role / secret key.
 * - Session persisted in expo-secure-store (secure-session-storage.ts), never AsyncStorage.
 * - PKCE flow for OAuth / magic links; `detectSessionInUrl: false` because there is no browser URL.
 * - Auto refresh runs only while the app is in the foreground (AppState listener below).
 *
 * Adapt:
 * - Import from this module everywhere; do not call createClient elsewhere.
 * - Use `supabase.auth.getUser()` / `getClaims()` when you need a server-verified identity;
 *   `getSession()` only reads local storage.
 * - Web target: guard the AppState block with `Platform.OS !== 'web'` (already done).
 * - react-native-url-polyfill: kept for full URL/URLSearchParams support; remove only after
 *   verifying auth redirects and storage URLs work without it on your RN version.
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { secureSessionStorage } from './secure-session-storage';
import { env } from './env';
import type { Database } from './database.types';

/** Explicit so sign-out.ts can delete the session even when the revoke request fails.
 *  Changing it in an existing app signs every user out once. */
export const SUPABASE_STORAGE_KEY = 'sb-auth';

export const supabase = createClient<Database>(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: {
    storage: secureSessionStorage,
    storageKey: SUPABASE_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
}

// Module scope on purpose: one listener for the app's lifetime, registered with the client.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', onAppStateChange);
  onAppStateChange(AppState.currentState);
}

/** Bearer token for your own API (api-client.ts). Returns null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Single refresh used by api-client's 401 handler. Returns the new token or null. */
export async function refreshAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}
