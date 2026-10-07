/**
 * error-boundary.tsx — expo-router ErrorBoundary + crash reporting with PII scrubbing.
 *
 * Deps:  npx expo install @sentry/react-native   (optional — see "Without Sentry" below)
 *        Sentry needs its config plugin in app.config and a dev-client rebuild.
 *
 * Usage:
 * - Root layout (app/_layout.tsx): call `initCrashReporting()` at module scope, and
 *   `export { RouteErrorBoundary as ErrorBoundary } from '@/lib/error-boundary';`
 * - Any route/layout wrapping a risky subtree can export it the same way; errors bubble to the
 *   nearest route that exports `ErrorBoundary`.
 *
 * Privacy:
 * - `sendDefaultPii: false`; `beforeSend` keeps only `user.id`, strips auth headers/cookies,
 *   query strings and token-like fields, and masks emails in messages.
 * - The fallback UI shows the raw error message only in __DEV__.
 *
 * Styling: replace the inline StyleSheet / Pressable with your design-system components and tokens.
 *
 * Without Sentry: delete the Sentry import and the bodies of `initCrashReporting` /
 * `reportError` (or call your own reporter there). Nothing else changes.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { env } from './env';

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|cookie|session|jwt|api[-_]?key|otp|pin/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return value.replace(EMAIL, '[email]');
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1);
    return out;
  }
  return value;
}

const stripQuery = (url?: string) => url?.split('?')[0];

export function initCrashReporting(): void {
  if (!env.EXPO_PUBLIC_SENTRY_DSN) return;
  Sentry.init({
    dsn: env.EXPO_PUBLIC_SENTRY_DSN,
    environment: env.EXPO_PUBLIC_APP_ENV,
    enabled: !__DEV__,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      if (event.request) {
        event.request.url = stripQuery(event.request.url);
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
      }
      if (event.message) event.message = event.message.replace(EMAIL, '[email]');
      for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = ex.value.replace(EMAIL, '[email]');
      event.extra = scrub(event.extra) as typeof event.extra;
      event.contexts = scrub(event.contexts) as typeof event.contexts;
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data?.url) crumb.data.url = stripQuery(String(crumb.data.url));
      if (crumb.message) crumb.message = crumb.message.replace(EMAIL, '[email]');
      crumb.data = scrub(crumb.data) as typeof crumb.data;
      return crumb;
    },
  });
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (__DEV__) console.error('[error]', error);
  Sentry.captureException(error, context ? { extra: scrub(context) as Record<string, unknown> } : undefined);
}

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route' });
  }, [error]);

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>{__DEV__ ? error.message : 'Please try again. If it keeps happening, restart the app.'}</Text>
      <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Try again" style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 15, textAlign: 'center', opacity: 0.8 },
  button: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  buttonText: { fontSize: 16, fontWeight: '500' },
});
