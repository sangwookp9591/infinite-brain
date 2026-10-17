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

Reference: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

Validation and commit list will be recorded after implementation.
