# OAuth audience / CIMD implementation

Design: canonical MCP resource is configured from BETTER_AUTH_URL; request Host,
Forwarded and X-Forwarded-* never determine issuer/audience. Only that normalized
resource is allowed (no aliases). Missing resource retains single-resource client
compatibility by binding explicitly to this server. Grants carry resource and a
random connection generation; issued OAuth tokens must carry both and match the
live connection. Exchange, consent and revoke serialize using PostgreSQL advisory
locks. Existing unbound OAuth tokens cannot prove an audience and must reconnect;
manual mcp_ tokens are local single-resource credentials and remain compatible.

CIMD supports HTTPS URL client identifiers and public PKCE clients. Fetches pin a
validated DNS address, reject non-public destinations and redirects, enforce
bounded response/time/cache, and require exact client_id and redirect_uri matches.
Unsupported authentication methods are rejected rather than advertised.

Reference: [MCP 2025-11 authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

Implementation and focused verification are complete.

## Implemented contract

- Migration `061_mcp_oauth_audience.sql` adds random connection generations,
  OAuth token resource/generation columns, and manual-token resource.
- `BETTER_AUTH_URL` is normalized to an origin and must use HTTPS, with HTTP
  permitted only on loopback for development. Credentials, query, fragment and
  path prefixes are rejected at startup. Set the externally visible origin
  explicitly behind a reverse proxy; no forwarded header is an authority.
- The resource allowlist contains exactly `<BETTER_AUTH_URL>/api/mcp`. URL
  serialization normalizes host case/default ports; query, fragment, trailing
  slash and another endpoint/origin do not identify this resource. Omitted
  resource binds to that one resource for existing single-resource clients.
- Consent grant JSON preserves `resource` and a random `generation`; a dedicated
  issuance gate copies them onto Better Auth's access-token row before exposing
  the response. Refresh grants must match as well. MCP auth joins token to its
  matching live connection generation, then keeps the existing membership,
  scope-intersection and owner/admin checks. No ACL resolver is bypassed.
- PostgreSQL session advisory locks serialize consent, authorization-code and
  refresh exchanges, and disconnect across processes, including Better Auth's
  independently pooled issuance. A completed disconnect cannot be undone by an
  earlier issuance; reconnect generates a distinct generation. Raw HTTP
  `/api/auth/oauth2/{authorize,token,consent}` routes are rejected because they
  bypass the branded vault-consent and audience contract; the trusted internal
  consent API remains in use. This is an intentional compatibility restriction.
- New manual tokens also bind the configured audience. Migration NULL manual
  tokens remain explicitly local legacy credentials and retain existing scopes.
- CIMD clients use HTTPS client IDs with a path, exact document client_id and
  redirect_uri matches, valid client_name/redirect_uris, and public PKCE auth.
  Unsupported client authentication/grant/response types are rejected. Client
  metadata is materialized in Better Auth's public-client table, so its PKCE,
  redirect, scope, expiry and client checks continue to apply.
- Fetch validates every DNS result, pins one public address to the TLS socket,
  keeps hostname certificate validation, uses no shared connection agent, never
  follows redirects, accepts JSON only, and caps response at 64 KiB and the whole
  operation at five seconds. Cache has at most 128 entries, respects no-store,
  no-cache/max-age and caps TTL at five minutes (60 seconds if unspecified).
  Private/loopback addresses need explicit `MCP_CIMD_ALLOW_PRIVATE_IPS=true`
  outside production; HTTPS and TLS certificate verification still apply.
  The public-address check is conservative (some special IPv4/IPv6 ranges are
  rejected wholesale). Private addresses remain blocked in production.

## Compatibility and rollout

Existing OAuth access/refresh tokens have no recoverable audience and receive
NULL resource/generation in migration 061; they intentionally return 401 and
require user reconnection. Retrofitting them to the current URL would claim an
unproven audience and could revive an old connection, so no automatic backfill
or sole-vault fallback is used. Existing connection/consent rows remain visible
for listing and revocation; new consent creates a valid generation. Existing
manual `mcp_` tokens remain usable with their prior ACL/scope rules. Changing
BETTER_AUTH_URL invalidates newly audience-bound tokens until recreated or
reconnected. No desktop source or visible UI layout was changed.

## Verification

All database tests used only container `ib-test-oauth`, port 55441, initially
`ib_oauth_test`, then fresh database `ib_oauth_fresh` to verify the completed
migration from scratch. Test-only fsync/synchronous_commit/full_page_writes were
disabled inside that disposable container for speed; shared databases and other
containers were untouched.

Early runs found the expected legacy-OAuth compatibility assertion and a
missing CIMD discovery flag, both corrected. One intermediate run used a DB
where the first draft of migration 061 was already applied and failed on its
subsequently added manual-token column; the fresh-database rerun removed that
stale-schema condition. Commands accidentally invoked from the repository root
failed with ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE and were rerun in the server package.


Final checks (from `app/apps/server`, with DATABASE_URL set to the dedicated
`ib_oauth_fresh` database on port 55441):

| Command | Result |
| --- | --- |
| `pnpm install` from `app/` | Passed; lockfile unchanged |
| `pnpm exec tsc --noEmit` | Passed, exit 0 |
| `pnpm exec vitest run tests/mcp*.test.ts tests/oauth-discovery.test.ts tests/desktop-oauth.test.ts` | **10 files, 130 tests passed**, 91.14 s |
| Fresh database migration through 061, verified via `_migrations` and `information_schema.columns` | Passed; all four resource/generation columns present |
| `git diff --check` | Passed |
| `docker rm -f ib-test-oauth` | Completed; only worker-owned disposable container removed |

Coverage includes OAuth token/grant audience mismatch, missing generation,
manual-token audience mismatch and legacy manual compatibility, legacy OAuth
rejection/list/revoke, old refresh rejection after generation change, disconnect
races paused *inside* Better Auth for both code and refresh issuance, reconnection
not reviving the revoked token, PKCE, scope/role checks, CIMD full consent/token/
refresh/MCP flow, exact redirect rejection, DNS pinning/mixed private records,
private IPv4/IPv6 and metadata endpoint blocking, production override denial,
JSON/size/redirect rejection, cache/no-store, DNS deadline/late-socket prevention,
and untrusted forwarded-header discovery.

## Unverified / remaining work

- Full server suite was **not run**; the MCP surface and related OAuth files were
  the requested focused scope. No desktop/native checks were needed because no
  desktop or visible UI layout changed.
- External real-client (Claude/ChatGPT) integration and real-network TLS/CIMD
  hosting were **not verified**. CIMD network security tests use controlled DNS
  and HTTPS transport fixtures while the integration test exercises the real
  Better Auth/database/HTTP/MCP pipeline.
- Operators must apply migration 061 before deploying the new server and tell
  existing OAuth users to reconnect. Public deployments using an HTTP non-loopback
  URL or URL path prefix must move to a configured HTTPS origin; aliases are
  intentionally unsupported. No merge, push or deployment was performed.
- No required implementation work remains for T1. The next integration owner
  should check migration numbering when combining parallel branches.

## Commits

- `5a21801` — docs: define OAuth audience and CIMD security contract
- `3edcabc` — feat(server): bind MCP OAuth audiences and support secure CIMD clients
- `e888af6` — test(server): cover CIMD audience and OAuth disconnect races
- Final documentation commit — docs: record OAuth audience and CIMD verification
