# Security Policy

## What SecureLink protects

- Client ↔ server protocol integrity
- Anonymous identity lifecycle (when enabled)
- Authorization integration hooks for custom auth
- Platform attestation / installation proof verification
- Request proof handling
- Server-side rate limiting for SecureLink-protected APIs

## What SecureLink does NOT protect

- Developer business logic or APIs
- User databases and registration systems
- Login UI or authentication providers (OAuth, password, etc.)
- Cloudflare / edge WAF configuration
- Application-specific authorization rules beyond adapters you provide

## Client-side limitations

Never assume a public client can keep a secret truly secret. Treat client credentials as untrusted until verified by `@securelink/server`.

## Reporting vulnerabilities

Please report security issues privately to the maintainers. Do not open public GitHub issues for vulnerabilities.
