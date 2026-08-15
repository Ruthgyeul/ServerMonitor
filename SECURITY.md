# Security Policy

## The API is sensitive and unauthenticated by default

`/api/system` and `/api/system/stream` return host reconnaissance: SSH session
source IPs and usernames, listening ports, top traffic peer IPs, firewall
state, and the running process list. **The endpoint is unauthenticated by
default**, and the `ALLOWED_ORIGINS` CORS list only restricts cross-origin
reads from browsers — it does nothing against `curl` or any script.

Before exposing this anywhere untrusted, read the **Securing the API** section
of the [README](README.md#securing-the-api). In short, pick at least one of:

1. **Network isolation (recommended)** — bind to localhost / a private network
   / a VPN, and front it with a reverse proxy that terminates TLS and enforces
   auth.
2. **Token gate** — set `API_AUTH_TOKEN` so every `/api/system*` request must
   present a bearer token or cookie.

`/api/health` and `/api/metrics` deliberately expose only non-sensitive data
(liveness and numeric metrics), so they can sit outside the token gate for
orchestration and Prometheus scraping.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the repository's **Security** tab) rather than a
public issue. Include reproduction steps and the affected version. You can
expect an initial acknowledgement within a few days.
