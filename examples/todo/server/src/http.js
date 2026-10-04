import { ProtocolError } from "@securelink/server";

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function send(res, status, body, origin = "*", extraHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    "access-control-allow-headers":
      "content-type, authorization, x-securelink-protocol, x-securelink-request-id, x-securelink-auth-mode, x-securelink-platform, x-securelink-proof, x-securelink-proof-type, x-securelink-authorization, x-securelink-installation-id",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-credentials": "true",
    ...extraHeaders,
  };
  // Node supports multiple Set-Cookie via array
  if (Array.isArray(headers["set-cookie"])) {
    res.writeHead(status, headers);
  } else {
    res.writeHead(status, headers);
  }
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

export function headersOf(req) {
  return req.headers;
}

export function payloadOf(body) {
  if (!body || typeof body !== "object") return undefined;
  if (body.body && typeof body.body === "object") return body.body;
  return body;
}

export function ok(ctx, data) {
  return {
    ok: true,
    status: 200,
    protocolVersion: "1.0",
    requestId: ctx?.requestMetadata?.requestId ?? "public",
    data,
  };
}

export function publicOk(data) {
  return { ok: true, status: 200, data };
}

export function err(status, requestId, message) {
  return {
    ok: false,
    status,
    protocolVersion: "1.0",
    requestId,
    error: { code: status === 404 ? "INTERNAL" : "PROTOCOL_INVALID", message },
  };
}

export { ProtocolError };
