# tests — agent rules

Unit and component tests for {{APP_NAME}}. Run with `{{TEST_CMD}}`.

## Use

- jest-expo preset + `@testing-library/react-native` for components and hooks.
- Test behavior through the public surface: what the user sees and does (`getByRole`, `getByText`, `userEvent.press`), not internal state.
- Pure `lib/` modules: plain unit tests, no React rendering.
- Hooks with queries: render with a fresh `QueryClient` per test (`retry: false`, `gcTime: Infinity`) wrapped in a provider.
- Mock at the network boundary (MSW or a mocked `{{API_CLIENT_MODULE}}`), not deep inside hooks.
- Native modules: mock in `jest.setup.ts` (`react-native-mmkv`, `expo-secure-store`, `expo-image`) once, shared by all tests.
- Cover the security-relevant paths: sign-out wipes every store, 401 → refresh → retry → sign-out, storage canary/ephemeral fallback, param validation on deep links.
- Fake timers for debounce/timeout logic; restore real timers after.
- Deterministic data: factories with explicit ids, no `Date.now()`/`Math.random()` in assertions.

## Never

- Real network calls, real credentials, or real user data in tests or fixtures.
- Snapshot entire screens as the only assertion.
- Share a `QueryClient` or store state between tests (reset in `afterEach`).
- `it.skip` / `it.only` left in committed code.
- Weaken a test to make a failing change pass; fix the code or explain why the expectation changed.
- Sleep-based waits (`setTimeout` in tests); use `waitFor` / `findBy*`.

## Patterns

```tsx
function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

it('shows items and opens detail', async () => {
  server.use(http.get('*/items', () => HttpResponse.json([{ id: 'a1', name: 'First' }])));
  renderWithClient(<ItemList />);
  await userEvent.press(await screen.findByText('First'));
  expect(router.push).toHaveBeenCalledWith('/item/a1');
});

it('sign-out wipes user data', async () => {
  appStorage.setJSON('u:1:draft', { v: 1 });
  await signOut();
  expect(appStorage.getJSON('u:1:draft', () => true)).toBeUndefined();
});
```

## Before finishing

- [ ] New logic has a test; bug fixes include a regression test.
- [ ] `{{TEST_CMD}}` passes locally, no skipped/focused tests.
- [ ] No secrets or real PII in fixtures.
- [ ] `{{TYPECHECK_CMD}}` covers test files too.
