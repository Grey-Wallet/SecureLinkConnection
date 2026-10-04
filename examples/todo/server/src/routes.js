import { securelink, formatSetCookie } from "./securelink.js";
import { publicInfo, todos } from "./store.js";
import {
  ProtocolError,
  err,
  headersOf,
  ok,
  payloadOf,
  publicOk,
  readBody,
  send,
} from "./http.js";

/**
 * Three access styles in this sample:
 * 1) PUBLIC      — no SecureLink
 * 2) ANONYMOUS   — SecureLink anonymous identity
 * 3) CUSTOM AUTH — your own Bearer token via SecureLink customAuth
 */

async function crud(res, ctx, collection, method, id, payload, origin) {
  const ownerId = ctx.identity.id;

  if (method === "GET" && !id) {
    return send(res, 200, ok(ctx, { items: collection.list(ownerId) }), origin);
  }
  if (method === "POST" && !id) {
    const title = String(payload?.title ?? "").trim();
    if (!title) {
      return send(res, 400, err(400, ctx.requestMetadata.requestId, "title is required"), origin);
    }
    return send(res, 200, ok(ctx, { item: collection.create(ownerId, title) }), origin);
  }
  if (method === "PATCH" && id) {
    const updated = collection.update(ownerId, id, {
      title: typeof payload?.title === "string" ? payload.title : undefined,
      done: typeof payload?.done === "boolean" ? payload.done : undefined,
    });
    if (!updated) {
      return send(res, 404, err(404, ctx.requestMetadata.requestId, "not found"), origin);
    }
    return send(res, 200, ok(ctx, { item: updated }), origin);
  }
  if (method === "DELETE" && id) {
    if (!collection.remove(ownerId, id)) {
      return send(res, 404, err(404, ctx.requestMetadata.requestId, "not found"), origin);
    }
    return send(res, 200, ok(ctx, { deleted: true, id }), origin);
  }
  return send(res, 404, err(404, "unknown", "not found"), origin);
}

function sendSecureLink(res, status, body, origin) {
  if (body?.setCookies?.length) {
    const headers = { "set-cookie": body.setCookies.map(formatSetCookie) };
    const { setCookies: _drop, ...rest } = body;
    return send(res, status, rest, origin, headers);
  }
  return send(res, status, body, origin);
}

export async function handleRequest(req, res, host, port) {
  const origin = String(req.headers.origin ?? "*");
  if (req.method === "OPTIONS") return send(res, 204, {}, origin);

  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    const body = await readBody(req);
    const incoming = {
      headers: headersOf(req),
      body,
      ip: req.socket.remoteAddress,
      method,
      path,
    };

    if (method === "POST" && path === "/securelink/anonymous/bootstrap") {
      return sendSecureLink(res, 200, await securelink.bootstrapAnonymous(incoming), origin);
    }
    if (method === "POST" && path === "/securelink/anonymous/refresh") {
      return sendSecureLink(res, 200, await securelink.refreshAnonymous(incoming), origin);
    }
    if (method === "POST" && path === "/securelink/attestation/challenge") {
      return send(res, 200, await securelink.createAttestationChallenge(incoming), origin);
    }
    if (method === "POST" && path === "/securelink/attestation/register") {
      return send(res, 200, await securelink.registerInstallation(incoming), origin);
    }

    if (method === "GET" && path === "/api/health") {
      return send(res, 200, publicOk({ service: "securelink-todo", access: "public" }), origin);
    }
    if (method === "GET" && path === "/api/public/info") {
      return send(res, 200, publicOk(publicInfo()), origin);
    }

    const todoMatch = path.match(/^\/api\/todos(?:\/([^/]+))?$/);
    if (todoMatch) {
      const ctx = await securelink.verify(incoming);
      if (ctx.authMode !== "anonymous" && ctx.authMode !== "customAuth") {
        return send(
          res,
          401,
          err(401, ctx.requestMetadata.requestId, "login required"),
          origin,
        );
      }
      return crud(res, ctx, todos, method, todoMatch[1], payloadOf(body), origin);
    }

    if (method === "GET" && path === "/api/account/profile") {
      const ctx = await securelink.verify(incoming);
      if (ctx.authMode !== "customAuth") {
        return send(
          res,
          401,
          err(401, ctx.requestMetadata.requestId, "this route requires customAuth"),
          origin,
        );
      }
      return send(
        res,
        200,
        ok(ctx, {
          access: "customAuth",
          userId: ctx.identity.id,
          message: "Your own auth token was accepted",
        }),
        origin,
      );
    }

    return send(res, 404, err(404, "unknown", "not found"), origin);
  } catch (e) {
    if (e instanceof ProtocolError) {
      return send(
        res,
        e.status,
        {
          ok: false,
          status: e.status,
          protocolVersion: "1.0",
          requestId: "unknown",
          error: { code: e.code, message: e.message, details: e.details },
        },
        origin,
      );
    }
    console.error(e);
    return send(res, 500, err(500, "unknown", "server error"), origin);
  }
}
