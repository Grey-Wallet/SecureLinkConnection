/** Current SecureLink protocol version */
export const PROTOCOL_VERSION = "1.0" as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION | string;

/** Client authentication mode */
export type AuthMode = "anonymous" | "customAuth";

/** Supported client platforms */
export type ClientPlatform = "web" | "react-native" | "extension" | "unknown";

/** Identity kinds SecureLink can represent */
export type IdentityType =
  | "anonymous"
  | "user"
  | "device"
  | "installation";

export interface ProtocolIdentity {
  id: string;
  type: IdentityType;
}

export interface AuthorizationMetadata {
  /** Opaque authorization material from SecureLink or the app */
  token?: string;
  /** Refresh credential when using rotating tokens */
  refreshToken?: string;
  /** App-provided authorization blob (customAuth) */
  authorization?: string;
  scheme?: "bearer" | "cookie" | "custom";
}

export interface ProofMetadata {
  /** Platform attestation or installation proof payload */
  proof?: string;
  /** Proof type identifier */
  type?: "app-attest" | "play-integrity" | "installation" | "none";
  /** Challenge echoed from server when applicable */
  challenge?: string;
}

export interface RequestMetadata {
  requestId: string;
  timestamp: number;
  method: string;
  path: string;
  platform: ClientPlatform;
  authMode: AuthMode;
  protocolVersion: ProtocolVersion;
}

/** Wire-level SecureLink request envelope */
export interface SecureLinkRequest {
  metadata: RequestMetadata;
  identity?: ProtocolIdentity;
  authorization?: AuthorizationMetadata;
  proof?: ProofMetadata;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Wire-level SecureLink response envelope */
export interface SecureLinkResponse<T = unknown> {
  ok: boolean;
  status: number;
  protocolVersion: ProtocolVersion;
  requestId: string;
  data?: T;
  error?: ProtocolErrorBody;
  /** Rotated credentials returned by server */
  credentials?: AuthorizationMetadata;
  identity?: ProtocolIdentity;
}

export type ProtocolErrorCode =
  | "PROTOCOL_INVALID"
  | "PROTOCOL_UNSUPPORTED_VERSION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PROOF_INVALID"
  | "PROOF_REQUIRED"
  | "IDENTITY_INVALID"
  | "CREDENTIAL_EXPIRED"
  | "CREDENTIAL_INVALID"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface ProtocolErrorBody {
  code: ProtocolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Minimum mutually supported protocol version */
export function isProtocolCompatible(
  clientVersion: string,
  serverVersion: string = PROTOCOL_VERSION,
): boolean {
  const [cMajor] = clientVersion.split(".").map(Number);
  const [sMajor] = serverVersion.split(".").map(Number);
  if (Number.isNaN(cMajor) || Number.isNaN(sMajor)) return false;
  return cMajor === sMajor;
}

export function createRequestId(): string {
  const bytes =
    globalThis.crypto?.getRandomValues?.(new Uint8Array(8)) ??
    Uint8Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `sl_${Date.now().toString(36)}_${rand}`;
}
