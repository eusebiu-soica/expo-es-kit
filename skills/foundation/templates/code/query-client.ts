/**
 * query-client.ts — the app's single TanStack Query v5 client, wired to AppState and NetInfo.
 *
 * Deps:  npx expo install @tanstack/react-query @react-native-community/netinfo
 *        (NetInfo is optional: loaded lazily via safe-native-import; without it the app assumes online.)
 *
 * Defaults:
 * - staleTime 60s: navigating back to a screen does not refetch everything.
 * - gcTime 10min: unused data is dropped from memory reasonably soon.
 * - retry 1 for queries, 0 for mutations (writes must not silently repeat; use idempotency keys).
 * - refetchOnWindowFocus false: "focus" on mobile = AppState 'active', handled by focusManager;
 *   opt in per query (`refetchOnWindowFocus: true`) for data that must be fresh on resume.
 *
 * Adapt:
 * - Provide once in the root layout: <QueryClientProvider client={queryClient}>.
 * - Call `setupQueryManagers()` once at startup (root layout module scope or first effect).
 * - Add one key factory per query family below; never write raw array keys in hooks.
 * - Sign-out calls `queryClient.clear()` (see sign-out.ts).
 */
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { lazyNativeModule } from './safe-native-import';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

type NetInfoModule = typeof import('@react-native-community/netinfo').default;
const netInfo = lazyNativeModule<NetInfoModule>(
  () => require('@react-native-community/netinfo').default,
  'NetInfo',
);

let managersReady = false;

/** Idempotent. Connects TanStack Query focus/online state to the native app lifecycle. */
export function setupQueryManagers(): void {
  if (managersReady || Platform.OS === 'web') return; // web uses the browser defaults
  managersReady = true;

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
  });

  const NetInfo = netInfo.get();
  if (NetInfo) {
    onlineManager.setEventListener((setOnline) =>
      NetInfo.addEventListener((state) => {
        // isInternetReachable is null while unknown; only trust an explicit false.
        setOnline(!!state.isConnected && state.isInternetReachable !== false);
      }),
    );
  }
}

/*
 * Query key factories — hierarchical so invalidation can target a whole family or one entry:
 *   queryClient.invalidateQueries({ queryKey: keys.items.lists() })   // every items list
 *   queryClient.invalidateQueries({ queryKey: keys.items.detail(id) }) // one item
 * Always pass a queryKey when invalidating; a bare call refetches the whole app.
 */
export interface ItemFilters {
  status?: 'open' | 'done';
  search?: string;
}

export const keys = {
  me: ['me'] as const,
  items: {
    all: ['items'] as const,
    lists: () => [...keys.items.all, 'list'] as const,
    list: (filters: ItemFilters = {}) => [...keys.items.lists(), filters] as const,
    details: () => [...keys.items.all, 'detail'] as const,
    detail: (id: string) => [...keys.items.details(), id] as const,
  },
};
