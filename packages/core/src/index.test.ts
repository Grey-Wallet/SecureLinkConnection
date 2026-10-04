import { describe, expect, it } from "vitest";
import {
  MemoryStorage,
  SecureLinkClient,
  createAnonymousIdentity,
  createSecureLinkClient,
} from "./index.js";
import type { Transport, TransportRequest, TransportResponse } from "./index.js";

function mockTransport(handler: (req: TransportRequest) => TransportResponse): Transport {
  return { send: async (req) => handler(req) };
}

describe("@securelink/core", () => {
  it("requires authorization provider in customAuth", () => {
    expect(() =>
      createSecureLinkClient({
        baseUrl: "http://localhost",
        authMode: "customAuth",
        platform: "web",
      }),
    ).toThrow(/authorization provider/);
  });

  it("creates anonymous identities", () => {
    const id = createAnonymousIdentity();
    expect(id.type).toBe("anonymous");
    expect(id.id.startsWith("anon_")).toBe(true);
  });

  it("bootstraps anonymous mode and skips identity in customAuth", async () => {
    const anon = createSecureLinkClient({
      baseUrl: "http://localhost",
      authMode: "anonymous",
      platform: "web",
      storage: new MemoryStorage(),
      transport: mockTransport((req) => {
        if (req.url.includes("/anonymous/bootstrap")) {
          return {
            status: 200,
            headers: {},
            body: {
              ok: true,
              status: 200,
              protocolVersion: "1.0",
              requestId: "r1",
              data: {
                identity: { id: "anon_1", type: "anonymous" },
                credentials: { token: "access", refreshToken: "refresh", scheme: "bearer" },
              },
            },
          };
        }
        return {
          status: 200,
          headers: {},
          body: { ok: true, status: 200, protocolVersion: "1.0", requestId: "r2", data: { ok: true } },
        };
      }),
    });

    await anon.initialize();
    const session = await anon.session.get();
    expect(session.identity?.type).toBe("anonymous");
    expect(session.credentials?.token).toBe("access");

    let sawAnonIdentity = false;
    const custom = new SecureLinkClient({
      baseUrl: "http://localhost",
      authMode: "customAuth",
      platform: "react-native",
      storage: new MemoryStorage(),
      attestation: {
        enabled: true,
        provider: {
          async getProof() {
            return { type: "app-attest", proof: "attest-token" };
          },
        },
      },
      authorization: {
        async getAuthorization() {
          return { authorization: "Bearer app-jwt", scheme: "custom" };
        },
      },
      transport: mockTransport((req) => {
        const body = req.body as { identity?: unknown; proof?: { proof?: string } };
        if (req.url.includes("/attestation/register")) {
          expect(body.proof?.proof).toBe("attest-token");
          expect(body.identity).toBeUndefined();
          return {
            status: 200,
            headers: {},
            body: { ok: true, status: 200, protocolVersion: "1.0", requestId: "r" },
          };
        }
        if ((req.body as { identity?: unknown }).identity) sawAnonIdentity = true;
        return {
          status: 200,
          headers: {},
          body: { ok: true, status: 200, protocolVersion: "1.0", requestId: "r", data: {} },
        };
      }),
    });

    await custom.initialize();
    const customSession = await custom.session.get();
    expect(customSession.identity).toBeNull();
    expect(customSession.credentials?.authorization).toContain("app-jwt");
    expect(sawAnonIdentity).toBe(false);
  });
});
