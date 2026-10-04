import { describe, expect, it } from "vitest";
import {
  MemoryRateLimitStore,
  RateLimitEngine,
  createSecureLinkServer,
} from "./index.js";
import { ProtocolError } from "@securelink/protocol";

describe("@securelink/server", () => {
  it("bootstraps anonymous credentials with hashed storage", async () => {
    const server = createSecureLinkServer({
      attestation: { enabled: false },
      rateLimit: { enabled: false },
      allowInsecureDevMode: true,
      tokenHashSecret: "test-secret",
    });

    const res = await server.bootstrapAnonymous({
      headers: {
        "x-securelink-platform": "web",
        "x-securelink-auth-mode": "anonymous",
      },
      body: {
        metadata: {
          requestId: "r1",
          timestamp: Date.now(),
          method: "POST",
          path: "/securelink/anonymous/bootstrap",
          platform: "web",
          authMode: "anonymous",
          protocolVersion: "1.0",
        },
      },
    });

    expect(res.ok).toBe(true);
    expect(res.data?.credentials.token).toBeTruthy();
    expect(res.data?.identity.id.startsWith("anon_")).toBe(true);
  });

  it("verifies customAuth with explicit validator", async () => {
    const server = createSecureLinkServer({
      attestation: { enabled: true },
      rateLimit: { enabled: false },
      allowInsecureDevMode: true,
      tokenHashSecret: "test-secret",
      authorizationValidator: {
        async validate() {
          return { valid: true, identity: { id: "user_app", type: "user" } };
        },
      },
    });

    const ctx = await server.verify({
      headers: {
        "x-securelink-protocol": "1.0",
        "x-securelink-auth-mode": "customAuth",
        "x-securelink-platform": "react-native",
        "x-securelink-proof": "attest-blob",
        "x-securelink-proof-type": "app-attest",
        authorization: "Bearer app-user-token",
      },
      method: "GET",
      path: "/api/me",
      body: {
        metadata: {
          requestId: "r2",
          timestamp: Date.now(),
          method: "GET",
          path: "/api/me",
          platform: "react-native",
          authMode: "customAuth",
          protocolVersion: "1.0",
        },
        proof: { type: "app-attest", proof: "attest-blob" },
        authorization: { authorization: "Bearer app-user-token", scheme: "custom" },
      },
      ip: "1.2.3.4",
    });

    expect(ctx.authMode).toBe("customAuth");
    expect(ctx.identity.id).toBe("user_app");
    expect(ctx.proofVerificationResult).toBe(true);
    expect(ctx.authorizationState).toBe("authenticated");
  });

  it("rate limits by endpoint", async () => {
    const engine = new RateLimitEngine({
      enabled: true,
      endpoint: { max: 2, windowMs: 60_000 },
      store: new MemoryRateLimitStore(),
    });

    expect((await engine.check({ endpoint: "GET /a", ip: "1" })).allowed).toBe(true);
    expect((await engine.check({ endpoint: "GET /a", ip: "1" })).allowed).toBe(true);
    const third = await engine.check({ endpoint: "GET /a", ip: "1" });
    expect(third.allowed).toBe(false);
    expect(third.limitedBy).toBe("endpoint");
  });

  it("throws RATE_LIMITED from verify when exceeded", async () => {
    const server = createSecureLinkServer({
      attestation: { enabled: false },
      allowInsecureDevMode: true,
      tokenHashSecret: "test-secret",
      rateLimit: {
        enabled: true,
        endpoint: { max: 1, windowMs: 60_000 },
        store: new MemoryRateLimitStore(),
      },
    });

    const bootstrap = await server.bootstrapAnonymous({
      headers: { "x-securelink-platform": "web" },
      body: {
        metadata: {
          requestId: "b",
          timestamp: Date.now(),
          method: "POST",
          path: "/securelink/anonymous/bootstrap",
          platform: "web",
          authMode: "anonymous",
          protocolVersion: "1.0",
        },
      },
    });

    const token = bootstrap.data!.credentials.token!;

    const makeReq = () =>
      server.verify({
        headers: {
          "x-securelink-protocol": "1.0",
          "x-securelink-auth-mode": "anonymous",
          "x-securelink-platform": "web",
          authorization: `Bearer ${token}`,
        },
        method: "GET",
        path: "/api/limited",
        body: {
          metadata: {
            requestId: "x",
            timestamp: Date.now(),
            method: "GET",
            path: "/api/limited",
            platform: "web",
            authMode: "anonymous",
            protocolVersion: "1.0",
          },
          authorization: { token, scheme: "bearer" },
        },
        ip: "9.9.9.9",
      });

    await makeReq();
    await expect(makeReq()).rejects.toMatchObject({ code: "RATE_LIMITED" } as ProtocolError);
  });

  it("requires tokenHashSecret outside insecure mode", () => {
    expect(() =>
      createSecureLinkServer({
        authMode: "anonymous",
        attestation: { enabled: false },
      }),
    ).toThrow(/tokenHashSecret/);
  });
});
