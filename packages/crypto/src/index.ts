import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  randomBytes as nobleRandom,
} from "@noble/hashes/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface SignedPayload {
  payload: string;
  signature: string;
  publicKey: string;
}

function getRandomBytes(bytes: number): Uint8Array {
  if (globalThis.crypto?.getRandomValues) {
    const arr = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(arr);
    return arr;
  }
  return nobleRandom(bytes);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Secure random bytes as hex */
export function secureRandom(bytes = 32): string {
  return bytesToHex(getRandomBytes(bytes));
}

/** SHA-256 hex digest */
export function sha256(input: string | Uint8Array): string {
  const data = typeof input === "string" ? utf8ToBytes(input) : input;
  return bytesToHex(nobleSha256(data));
}

/** HMAC-SHA256 hex digest (server secrets, token hashing helpers) */
export function hmacSha256(secret: string, input: string): string {
  return bytesToHex(hmac(nobleSha256, utf8ToBytes(secret), utf8ToBytes(input)));
}

/**
 * Ed25519 signing keypair (hex-encoded).
 * Server verifies with publicKey only — private key never leaves the client.
 */
export function generateKeyPair(): KeyPair {
  const privateKeyBytes = ed25519.utils.randomPrivateKey();
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  return {
    privateKey: bytesToHex(privateKeyBytes),
    publicKey: bytesToHex(publicKeyBytes),
  };
}

/** Sign a UTF-8 payload with an Ed25519 private key (hex). */
export function sign(privateKey: string, payload: string): string {
  const sig = ed25519.sign(utf8ToBytes(payload), hexToBytes(privateKey));
  return bytesToHex(sig);
}

/**
 * Verify an Ed25519 signature with public key only.
 * Overload kept for migration: verify(publicKey, payload, signature)
 * Legacy 4-arg form still accepted: verify(publicKey, _privateKey, payload, signature)
 */
export function verify(
  publicKey: string,
  payloadOrPrivateKey: string,
  signatureOrPayload: string,
  maybeSignature?: string,
): boolean {
  const publicKeyBytes = hexToBytes(publicKey);
  let payload: string;
  let signature: string;
  if (maybeSignature !== undefined) {
    payload = signatureOrPayload;
    signature = maybeSignature;
  } else {
    payload = payloadOrPrivateKey;
    signature = signatureOrPayload;
  }
  try {
    return ed25519.verify(
      hexToBytes(signature),
      utf8ToBytes(payload),
      publicKeyBytes,
    );
  } catch {
    return false;
  }
}

export function createChallenge(bytes = 16): string {
  return secureRandom(bytes);
}

export function buildRequestProofPayload(parts: {
  requestId: string;
  timestamp: number;
  method: string;
  path: string;
  bodyHash?: string;
}): string {
  return [
    parts.requestId,
    String(parts.timestamp),
    parts.method.toUpperCase(),
    parts.path,
    parts.bodyHash ?? "",
  ].join("|");
}

export function hashBody(body: unknown): string {
  if (body === undefined || body === null) return "";
  return sha256(typeof body === "string" ? body : JSON.stringify(body));
}

export function createSignedRequestProof(input: {
  privateKey: string;
  publicKey: string;
  requestId: string;
  timestamp: number;
  method: string;
  path: string;
  body?: unknown;
}): SignedPayload {
  const payload = buildRequestProofPayload({
    requestId: input.requestId,
    timestamp: input.timestamp,
    method: input.method,
    path: input.path,
    bodyHash: hashBody(input.body),
  });
  return {
    payload,
    signature: sign(input.privateKey, payload),
    publicKey: input.publicKey,
  };
}

/** Verify request proof with public key only (production-safe). */
export function verifySignedRequestProof(input: {
  publicKey: string;
  payload: string;
  signature: string;
  /** @deprecated unused — kept for call-site compatibility */
  privateKey?: string;
}): boolean {
  return verify(input.publicKey, input.payload, input.signature);
}

/** Hash opaque tokens before persisting (access/refresh). */
export function hashToken(token: string, secret: string): string {
  return hmacSha256(secret, token);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    return timingSafeEqualBytes(hexToBytes(a), hexToBytes(b));
  } catch {
    return false;
  }
}

export function toBase64Url(value: string): string {
  const bytes = utf8ToBytes(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const b64 = padded + pad;
  if (typeof atob === "function") {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}
