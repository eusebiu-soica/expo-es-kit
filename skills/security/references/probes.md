# Dynamic probes (`--probe` only)

Probes confirm what static analysis cannot: runtime authorization, live RLS, platform limits. They extend the "active probing" rules in `skills/backend/SKILL.md` (ask first, local or preview only, test accounts only, never production) and keep every one of those rules.

## Safety checklist

Confirm every item with the user via AskUserQuestion **before** sending any request. If an item fails, run no probes, and record "probes not run: <reason>" under Not checked.

1. [ ] The user passed `--probe` **and** confirmed in this session: "Run the probes against `<BASE_URL>` / `<SUPABASE_URL>`?"
2. [ ] The target is `localhost` / `127.0.0.1` / `10.0.2.2`, a Vercel preview URL, or a Supabase **branch** or local project **that the user named**. Never infer a target from config.
3. [ ] The user states the target is **not production** and holds no real user data. If the Supabase project ref or the domain matches the production values in `.env*`/`eas.json`, stop.
4. [ ] Two test accounts, **A** and **B**, were provided by the user (credentials or JWTs), plus optionally an admin test account. Never create accounts on shared environments without asking.
5. [ ] The probes are non-destructive:
   - no `DELETE` / `PATCH` on rows the probe did not create
   - writes target only resources created by A or B for this test, cleaned up afterwards by their owner
6. [ ] The probe list has been shown and approved, and bursts are capped at **30 requests** per probe, ≥ 100 ms apart unless the user allows faster.
7. [ ] Secrets are kept out of output: tokens live in shell variables, are never echoed, are masked in the report (`eyJ…` → `<A_JWT>`), and are unset at the end.
8. [ ] Vercel preview protection: if the preview returns the Vercel login page, use the user's bypass method (`vercel curl`, protection bypass header). Never disable protection.

Setup (values from the user; nothing is written to the repo):

```bash
export BASE="https://<preview>.vercel.app"            # or http://localhost:3000, or $SUPABASE_URL/functions/v1
export SB="https://<branch-ref>.supabase.co"           # or http://127.0.0.1:54321
export PK="<publishable or anon key>"
jwt() { curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $PK" -H 'Content-Type: application/json' \
          -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r .access_token; }
A_JWT=$(jwt "$A_EMAIL" "$A_PASS"); B_JWT=$(jwt "$B_EMAIL" "$B_PASS")
code() { curl -s -o /dev/null -w '%{http_code}\n' "$@"; }
```

Record each probe as `| Probe | Request (masked) | Expected | Got | Verdict |`. A failed probe becomes a finding with `confidence: high`, `verified: confirmed`, and the request and response status as `evidence`.

---

## P-01 · BOLA swap A→B
**Purpose:** prove that every sampled resource route scopes by the caller (ACL-02, API1).
**Steps:** as B, create a resource (or use one of B's existing test resources) and note `B_ID`. Then call each id-bearing route with A's token:
```bash
code "$BASE/api/v1/notes/$B_ID" -H "Authorization: Bearer $A_JWT"
code -X PATCH "$BASE/api/v1/notes/$B_ID" -H "Authorization: Bearer $A_JWT" -H 'Content-Type: application/json' -d '{"title":"probe"}'
code -X POST "$BASE/api/v1/notes" -H "Authorization: Bearer $A_JWT" -H 'Content-Type: application/json' -d "{\"projectId\":\"$B_PROJECT_ID\",\"title\":\"probe\"}"
```
**Expected:** 404 (or 403) for reads and writes, and B's resource unchanged (re-read it as B). A nested parent id of B's is rejected.
**Failure:** ACL-02 **P0** (read or write of another user's object). A 403-vs-404 difference only leaks existence: P2.

## P-02 · No token / expired / tampered token
**Purpose:** prove that routes verify JWTs (AUTH-04, BE-A01, API2).
```bash
code "$BASE/api/v1/me"                                                   # no token
code "$BASE/api/v1/me" -H "Authorization: Bearer $EXPIRED_JWT"          # user-supplied old token past exp
TAMPERED=$(node -e 'const [h,p,s]=process.argv[1].split(".");const o=JSON.parse(Buffer.from(p,"base64url"));o.sub=process.argv[2];console.log([h,Buffer.from(JSON.stringify(o)).toString("base64url"),s].join("."))' "$A_JWT" "$B_UUID")
code "$BASE/api/v1/me" -H "Authorization: Bearer $TAMPERED"              # payload changed, signature kept
NONE=$(node -e 'const p=process.argv[1].split(".")[1];console.log(Buffer.from("{\"alg\":\"none\",\"typ\":\"JWT\"}").toString("base64url")+"."+p+".")' "$A_JWT")
code "$BASE/api/v1/me" -H "Authorization: Bearer $NONE"                  # alg none
```
**Expected:** 401 for all four. Repeat this for every route in `api.routesWithoutAuthSignal` that is not public by design.
**Failure:** a tampered or `alg:none` token accepted → AUTH-04 / ACL-08 **P0** (decode-only verification). An expired token accepted → P0 if the route trusts it as identity. No token accepted on a private route → ACL-01 / BE-A01 **P0**.

## P-03 · PostgREST filter injection
**Purpose:** confirm INJ-01 where user input reaches `.or()` / `.filter()` (in the API or client), and check the raw Data API grammar against RLS.
```bash
# via the app's API (search param forwarded into .or())
for q in 'x,id.gt.0' 'x)' 'x),or(id.not.is.null' '"' 'x,owner_id.neq.00000000-0000-0000-0000-000000000000'; do
  curl -s -G "$BASE/api/v1/search" --data-urlencode "q=$q" -H "Authorization: Bearer $A_JWT" -w ' %{http_code}\n' | tail -c 200
done
# directly against the Data API as A: an or-tree cannot widen beyond RLS
curl -s -G "$SB/rest/v1/notes" -H "apikey: $PK" -H "Authorization: Bearer $A_JWT" \
  --data-urlencode 'select=id,owner_id' --data-urlencode 'or=(owner_id.eq.'"$B_UUID"',id.not.is.null)'
```
**Expected:** the API returns 400, or results equal to a literal search for the string, never rows outside A's scope, and never a 500 with a PostgREST error (`PGRST100` "failed to parse logic tree") in the body. The direct call returns only A's rows.
**Failure:** rows of B returned through the API → INJ-01 **P0** (privileged client) or **P1**. A 500 or parse error echoed → INJ-01 P2 plus HARD-07. B's rows from the direct call → ACL-07 **P0**.

## P-04 · SQL-ish and pattern payloads on search and textarea fields
**Purpose:** detect concatenated SQL, unescaped wildcards and error leaks (INJ-02, INJ-03, HARD-07).
```bash
for q in "' OR 1=1--" '%' '_' '\' '%%%%' 'a%b_c' "') ; select pg_sleep(3)--" 'ʼ＇＂' $'line\nbreak' "$(printf 'a%.0s' {1..5000})"; do
  curl -s -G "$BASE/api/v1/search" --data-urlencode "q=$q" -H "Authorization: Bearer $A_JWT" \
    -w ' | %{http_code} %{time_total}s\n' -o "$TMPDIR/probe-body"; head -c 120 "$TMPDIR/probe-body"; echo
done
```
Also submit the same strings once through each textarea-backed POST route. Use a resource A created for the test, then compare what is stored with what was sent.
**Expected:** 200/400 with literal handling. `%` and `_` should not return more than a literal search does, response time should not jump (no `pg_sleep` effect), and the 5,000-character string should be rejected or truncated (400). Errors stay generic.
**Failure:** a SQL error text, or a ~3 s delay → INJ-03/INJ-04 **P0**. `%` returning everything → INJ-02 P2 (P1 if it is an exact-match gate). A 500 or a stack trace → HARD-07 P1.

## P-05 · Oversized body
```bash
head -c 2000000 /dev/zero | tr '\0' 'a' | jq -Rs '{title:"probe",body:.}' > "$TMPDIR/big.json"
code -X POST "$BASE/api/v1/notes" -H "Authorization: Bearer $A_JWT" -H 'Content-Type: application/json' --data-binary @"$TMPDIR/big.json"
```
**Expected:** 413 or 400 before the handler does work. Vercel rejects function payloads above 4.5 MB, so 2 MB tests the app's own cap.
**Failure:** 2xx and the body stored → HARD-02 P1 (P2 if a zod `max` truncates later but the server still parses everything).

## P-06 · Rate-limit burst (max 30)
```bash
for i in $(seq 1 30); do code -X POST "$BASE/api/v1/auth/otp/verify" -H 'Content-Type: application/json' -d '{"email":"<A_EMAIL>","token":"000000"}'; sleep 0.1; done | sort | uniq -c
```
Run it on one auth-adjacent route (login/OTP/invite/reset) and one cost-bearing route (AI, SMS, export). For Supabase Auth itself, rely on the dashboard limits and ask the user rather than burst-testing the provider.
**Expected:** 429 appears at or below the documented limit, with a `Retry-After` header.
**Failure:** no 429 in 30 requests on an auth-adjacent route → HARD-01 / AUTH-11 **P1** (confidence medium: the limit may be higher than 30; ask what it is). On a cost route → P1. Elsewhere → P2.

## P-07 · Open redirect parameter
```bash
for p in next redirect redirect_to returnTo callbackUrl; do
  for v in 'https://evil.example' '//evil.example' '/\evil.example' 'https:evil.example' 'javascript:alert(1)'; do
    curl -s -o /dev/null -w "$p=$v -> %{http_code} %{redirect_url}\n" -G "$BASE/auth/callback" --data-urlencode "$p=$v"
  done
done
```
**Expected:** a redirect only to the app's own origin, an allow-listed scheme (`myapp://`), or a fixed fallback.
**Failure:** `Location` points to `evil.example` or another scheme → URL-05 **P1** (P0 if an auth code or token is appended to the redirect).

## P-08 · Sensitive parameters in server logs
**Purpose:** check URL-01/URL-02/DATA-01 where code review shows ids, emails or tokens in query strings.
1. Generate a marker: `M="probe-$(openssl rand -hex 6)"`.
2. Send a request shaped like the app's real one, with the marker in place of the sensitive value: `code -G "$BASE/api/v1/lookup" --data-urlencode "email=$M@example.test" -H "Authorization: Bearer $A_JWT"`.
3. Ask the user to search for `$M` in Vercel runtime/request logs, Supabase API/Edge logs, Sentry and analytics. Never read production logs yourself unless the user grants access.

**Expected:** the marker is absent, or present only in places the user deems acceptable.
**Failure:** the marker appears in request-URL logs or third-party tools → URL-01 P1 (P0 if the real parameter is a token or credential, URL-02).

## P-09 · RLS two-user test via the Data API
**Purpose:** confirm the access matrix live (ACL-07, ACL-09, ACL-10, ACL-11, API1/API5). Run it on each table, RPC and bucket the app touches (`inputSurfaces[].sinks`, `rls.policies[].table`).
```ts
// run with: npx tsx probe-rls.ts (in the scratchpad, not in the repo)
import { createClient } from '@supabase/supabase-js';
const mk = async (email: string, password: string) => {
  const c = createClient(process.env.SB!, process.env.PK!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error; return c;
};
const a = await mk(process.env.A_EMAIL!, process.env.A_PASS!);
const b = await mk(process.env.B_EMAIL!, process.env.B_PASS!);
const anon = createClient(process.env.SB!, process.env.PK!, { auth: { persistSession: false } });
const { data: { user: bUser } } = await b.auth.getUser();
const { data: bRow } = await b.from('notes').insert({ title: 'probe-b' }).select('id').single(); // B's own test row
const results = {
  aSelectB: (await a.from('notes').select('id').eq('id', bRow!.id)).data,                                       // expect []
  aUpdateB: (await a.from('notes').update({ title: 'x' }).eq('id', bRow!.id).select('id')).data,                // expect []
  aDeleteB: (await a.from('notes').delete().eq('id', bRow!.id).select('id')).data,                              // expect [] (row is B's test row)
  aInsertAsB: (await a.from('notes').insert({ title: 'x', user_id: bUser!.id })).error?.code,                   // expect '42501'
  aEscalate: (await a.from('profiles').update({ role: 'admin' }).eq('id', (await a.auth.getUser()).data.user!.id).select('role')).error?.code, // expect error
  anonSelect: (await anon.from('notes').select('id').limit(1)).data,                                            // expect [] or error
  aRpcPrivileged: (await a.rpc('admin_set_plan', { p_user: bUser!.id, p_plan: 'pro' })).error?.code,           // expect error
  aStorageListB: (await a.storage.from('user-media').list(bUser!.id)).data,                                     // expect []
};
console.log(JSON.stringify(results, null, 2));
await b.from('notes').delete().eq('id', bRow!.id); // cleanup by owner
```
Adapt the table names, columns and RPCs to the access matrix. For Realtime, subscribe A to a private topic of B and expect a subscribe error or no messages.
**Expected:** every A→B operation returns empty or an error, anon gets nothing, and the privileged RPC is denied.
**Failure:** any non-empty `aSelectB` / `aUpdateB` / `aDeleteB`, or a successful `aInsertAsB` → ACL-07 **P0**. `aEscalate` succeeds → ACL-05 **P0**. `aRpcPrivileged` succeeds → ACL-04/ACL-10 **P0**. Anon reads data → ACL-01 **P0**. B's files listed → ACL-11 **P0** (names only: P1).

---

## After probing

- Clean up: delete the test rows and files created by A/B (as their owners), unset the token variables, and remove scratch files.
- In the report, add a "Probe results" table with the target (masked host), date, accounts used (A/B labels only), and one row per probe.
- Probe outcomes move OWASP rows from "⚪ not checked" to ✅ or ❌ (see `owasp-mapping.md`).
