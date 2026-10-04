import { describe, expect, it } from "vitest";
import { createSecureLinkClient, MemoryStorage } from "../../packages/core/src/index.js";
import { createSecureLinkServer } from "../../packages/server/src/index.js";
import type { TransportRequest, TransportResponse } from "../../packages/core/src/index.js";

describe("integration: client ↔ server", () => {
  it("anonymous bootstrap then protected request", async () => {
    const server = createSecureLinkServer({
      attestation: { enabled: false },
      rateLimit: { enabled: true, endpoint: { max: 50, windowMs: 60_000 } },
      allowInsecureDevMode: true,
      tokenHashSecret: "test-integration-secret",
      authMode: "anonymous",
    });

    const transport = {
      async send(req: TransportRequest): Promise<TransportResponse> {
        const url = new URL(req.url);
        const incoming = {
          headers: req.headers ?? {},
          body: req.body,
          method: req.method,
          path: url.pathname,
          ip: "127.0.0.1",
        };

        if (url.pathname.includes("/anonymous/bootstrap")) {
          const body = await server.bootstrapAnonymous(incoming);
          return { status: body.status, headers: {}, body };
        }

        try {
          const ctx = await server.verify(incoming);
          return {
            status: 200,
            headers: {},
            body: {
              ok: true,
              status: 200,
              protocolVersion: "1.0",
              requestId: ctx.requestMetadata.requestId,
              data: { identity: ctx.identity },
            },
          };
        } catch (e: unknown) {
          const err = e as { status?: number; code?: string; message?: string };
          return {
            status: err.status ?? 500,
            headers: {},
            body: {
              ok: false,
              status: err.status ?? 500,
              protocolVersion: "1.0",
              requestId: "x",
              error: { code: err.code ?? "INTERNAL", message: err.message ?? "error" },
            },
          };
        }
      },
    };

    const client = createSecureLinkClient({
      baseUrl: "http://securelink.test",
      authMode: "anonymous",
      platform: "web",
      storage: new MemoryStorage(),
      transport,
    });

    await client.initialize();
    const res = await client.request({ method: "GET", path: "/api/hello" });
    expect(res.ok).toBe(true);
    expect((res.data as { identity: { type: string } }).identity.type).toBe("anonymous");
  });
});
