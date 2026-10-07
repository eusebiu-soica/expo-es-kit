/**
 * safe-native-import.ts — lazy, guarded access to optional native modules.
 *
 * Deps: none.
 *
 * Why: a top-level `import NetInfo from '@react-native-community/netinfo'` throws at module
 * evaluation when the native side is missing (stale dev client, Expo Go, Jest without a mock),
 * taking the whole import graph down with it. Wrapping the `require` defers resolution to
 * first use and turns "native module missing" into `null`, so the feature degrades instead.
 *
 * Adapt:
 * - Use only for optional capabilities (network status, haptics, analytics, review prompts).
 *   Core modules the app cannot run without should be imported normally and fail loudly.
 * - Keep the `require('literal')` inside the arrow: Metro must see a static string to bundle it.
 * - After installing a native module, rebuild the dev client; this wrapper only hides the crash.
 */

export interface LazyNativeModule<T> {
  /** The module, or null if its native code is unavailable. Resolved once, then cached. */
  get(): T | null;
  /** True when the module loaded successfully. */
  available(): boolean;
}

export function lazyNativeModule<T>(load: () => T, name = 'native module'): LazyNativeModule<T> {
  let state: { resolved: false } | { resolved: true; value: T | null } = { resolved: false };

  const get = (): T | null => {
    if (state.resolved) return state.value;
    let value: T | null = null;
    try {
      value = load() ?? null; // the loader picks the export: require('x').default or require('x')
    } catch (err) {
      if (__DEV__) console.warn(`[safe-native-import] ${name} unavailable:`, (err as Error)?.message);
      value = null;
    }
    state = { resolved: true, value };
    return value;
  };

  return { get, available: () => get() !== null };
}

/*
 * Examples
 *
 * type NetInfoModule = typeof import('@react-native-community/netinfo').default;
 * export const netInfo = lazyNativeModule<NetInfoModule>(
 *   () => require('@react-native-community/netinfo').default,
 *   'NetInfo',
 * );
 * const NetInfo = netInfo.get();            // NetInfoModule | null
 * const unsubscribe = NetInfo?.addEventListener((s) => setOnline(!!s.isConnected)) ?? (() => {});
 *
 * export const haptics = lazyNativeModule<typeof import('expo-haptics')>(() => require('expo-haptics'), 'expo-haptics');
 * haptics.get()?.selectionAsync().catch(() => {});
 */
