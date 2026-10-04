import { createSecureLinkServer, formatSetCookie } from "@securelink/server";

/**
 * Demo custom-auth validator.
 * Accepts: Authorization: Bearer demo-<username>
 * Real apps: validate your JWT/session here.
 */
const authorizationValidator = {
  async validate(authorization) {
    const raw =
      authorization.authorization ??
      (authorization.token ? `Bearer ${authorization.token}` : "");
    const token = String(raw).replace(/^Bearer\s+/i, "").trim();

    if (!token.startsWith("demo-") || token.length < 6) {
      return { valid: false, identity: { id: "unknown", type: "user" } };
    }

    const username = token.slice("demo-".length);
    return {
      valid: true,
      identity: { id: `user_${username}`, type: "user" },
    };
  },
};

/**
 * Local todo demo server.
 * allowInsecureDevMode is OK here — never copy that flag into production.
 */
export const securelink = createSecureLinkServer({
  authMode: "both",
  attestation: { enabled: true },
  authorizationValidator,
  allowInsecureDevMode: true,
  tokenHashSecret: "todo-example-dev-secret-change-me",
  rateLimit: {
    enabled: true,
    user: { max: 200, windowMs: 60_000 },
    ip: { max: 400, windowMs: 60_000 },
    endpoint: { max: 60, windowMs: 60_000 },
  },
});

export { formatSetCookie };
