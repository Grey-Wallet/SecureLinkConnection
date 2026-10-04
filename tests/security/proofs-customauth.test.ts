import { describe, expect, it } from "vitest";
import { createReactNativeSecureLink } from "../../packages/react-native/src/index.js";
import { createExtensionSecureLink } from "../../packages/extension/src/index.js";
import { MemoryStorage } from "../../packages/core/src/index.js";
import type { TransportRequest, TransportResponse } from "../../packages/core/src/index.js";

const okTransport = {
  async send(req: TransportRequest): Promise<TransportResponse> {
    if (String(req.url).includes("/bootstrap") || String(req.url).includes("/attestation")) {
      return {
        status: 200,
        headers: {},
        body: {
          ok: true,
          status: 200,
          protocolVersion: "1.0",
          requestId: "r",
          data: {
            identity: { id: "anon_1", type: "anonymous" },
            credentials: { token: "a", refreshToken: "r", scheme: "bearer" },
            registered: true,
          },
        },
      };
    }
    const headers = req.headers ?? {};
    return {
      status: 200,
      headers: {},
      body: {
        ok: true,
        status: 200,
        protocolVersion: "1.0",
        requestId: "r",
        data: { proof: headers["x-securelink-proof"], mode: headers["x-securelink-auth-mode"] },
      },
    };
  },
};

describe("security: proofs remain in customAuth", () => {
  it("react-native sends app-attest proof without anonymous identity", async () => {
    const client = createReactNativeSecureLink({
      baseUrl: "http://test",
      authMode: "customAuth",
      nativePlatform: "ios",
      attestationEnabled: true,
      secureStorage: new MemoryStorage(),
      allowInsecureDevAttestation: true,
      transport: okTransport,
      authorization: {
        async getAuthorization() {
          return { authorization: "Bearer u", scheme: "custom" };
        },
      },
    });

    await client.initialize();
    const session = await client.session.get();
    expect(session.identity).toBeNull();

    const res = await client.request({ method: "GET", path: "/api/x" });
    expect(res.ok).toBe(true);
    expect(String((res.data as { proof: string }).proof)).toContain("attest");
  });

  it("extension sends installation proof", async () => {
    const client = await createExtensionSecureLink({
      baseUrl: "http://test",
      authMode: "anonymous",
      storage: new MemoryStorage(),
      transport: okTransport,
      installationProofEnabled: true,
      allowMemoryFallback: true,
    });
    await client.initialize();
    const res = await client.request({ method: "GET", path: "/api/x" });
    expect(res.ok).toBe(true);
    expect(String((res.data as { proof: string }).proof).length).toBeGreaterThan(10);
  });
});
