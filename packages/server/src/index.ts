import {
  PROTOCOL_VERSION,
  ProtocolError,
  isProtocolCompatible,
  type AuthMode,
  type AuthorizationMetadata,
  type ClientPlatform,
  type IdentityType,
  type ProofMetadata,
  type ProtocolIdentity,
  type ProtocolVersion,
  type SecureLinkRequest,
  type SecureLinkResponse,
} from "@securelink/protocol";
import {
  hashToken,
  secureRandom,
  sha256,
  verifySignedRequestProof,
} from "@securelink/crypto";

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitWindow {
  max: number;
  windowMs: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  user?: RateLimitWindow;
  device?: RateLimitWindow;
  installation?: RateLimitWindow;
  ip?: RateLimitWindow;
  endpoint?: RateLimitWindow;
  store?: RateLimitStore;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<number>;
  /** Remaining ms until the current window resets (optional). */
  ttl?(key: string): Promise<number | null>;
  reset?(key: string): Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async ttl(key: string): Promise<number | null> {
    const existing = this.buckets.get(key);
    if (!existing) return null;
    return Math.max(0, existing.resetAt - Date.now());
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}

/** Minimal Redis surface for production rate-limit backends. */
export interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private redis: RedisLike,
    private prefix = "securelink:rl:",
  ) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const k = `${this.prefix}${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.pexpire(k, windowMs);
    return count;
  }

  async ttl(key: string): Promise<number | null> {
    const ms = await this.redis.pttl(`${this.prefix}${key}`);
    return ms > 0 ? ms : null;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`${this.prefix}${key}`);
  }
}

export interface RateLimitCheckInput {
  userId?: string;
  anonymousId?: string;
  deviceId?: string;
  installationId?: string;
  ip?: string;
  endpoint: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limitedBy?: string;
  retryAfterMs?: number;
}

export class RateLimitEngine {
  private store: RateLimitStore;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.store = config.store ?? new MemoryRateLimitStore();
  }

  async check(input: RateLimitCheckInput): Promise<RateLimitResult> {
    if (!this.config.enabled) return { allowed: true };

    const checks: Array<{ name: string; id?: string; window?: RateLimitWindow }> = [
      { name: "user", id: input.userId ?? input.anonymousId, window: this.config.user },
      { name: "device", id: input.deviceId, window: this.config.device },
      { name: "installation", id: input.installationId, window: this.config.installation },
      { name: "ip", id: input.ip, window: this.config.ip },
      { name: "endpoint", id: input.endpoint, window: this.config.endpoint },
    ];

    for (const check of checks) {
      if (!check.window || !check.id) continue;
      const key = `${check.name}:${check.id}:${input.endpoint}`;
      const count = await this.store.increment(key, check.window.windowMs);
      if (count > check.window.max) {
        const retryAfterMs =
          (await this.store.ttl?.(key)) ?? check.window.windowMs;
        return { allowed: false, limitedBy: check.name, retryAfterMs };
      }
    }

    return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Token / credential store (anonymous mode) — hashed at rest
// ---------------------------------------------------------------------------

export interface IssuedCredentials extends AuthorizationMetadata {
  token: string;
  refreshToken: string;
  identityId: string;
  expiresAt: number;
  refreshExpiresAt: number;
}

export interface StoredCredentialRecord {
  accessTokenHash: string;
  refreshTokenHash: string;
  identityId: string;
  expiresAt: number;
  refreshExpiresAt: number;
  /** Previous refresh hash — reuse of old refresh after rotate = theft */
  previousRefreshTokenHash?: string;
}

export interface CredentialStore {
  save(record: StoredCredentialRecord): Promise<void>;
  getByAccessTokenHash(hash: string): Promise<StoredCredentialRecord | null>;
  getByRefreshTokenHash(hash: string): Promise<StoredCredentialRecord | null>;
  revokeByAccessTokenHash(hash: string): Promise<void>;
  revokeByRefreshTokenHash(hash: string): Promise<void>;
  /** Mark refresh hash as used (for reuse detection after rotation). */
  markRefreshUsed?(hash: string): Promise<void>;
  wasRefreshUsed?(hash: string): Promise<boolean>;
}

export class MemoryCredentialStore implements CredentialStore {
  private byAccess = new Map<string, StoredCredentialRecord>();
  private byRefresh = new Map<string, StoredCredentialRecord>();
  private usedRefresh = new Set<string>();

  async save(record: StoredCredentialRecord): Promise<void> {
    this.byAccess.set(record.accessTokenHash, record);
    this.byRefresh.set(record.refreshTokenHash, record);
  }

  async getByAccessTokenHash(hash: string): Promise<StoredCredentialRecord | null> {
    return this.byAccess.get(hash) ?? null;
  }

  async getByRefreshTokenHash(hash: string): Promise<StoredCredentialRecord | null> {
    return this.byRefresh.get(hash) ?? null;
  }

  async revokeByAccessTokenHash(hash: string): Promise<void> {
    const record = this.byAccess.get(hash);
    if (!record) return;
    this.byAccess.delete(record.accessTokenHash);
    this.byRefresh.delete(record.refreshTokenHash);
  }

  async revokeByRefreshTokenHash(hash: string): Promise<void> {
    const record = this.byRefresh.get(hash);
    if (!record) return;
    this.byAccess.delete(record.accessTokenHash);
    this.byRefresh.delete(record.refreshTokenHash);
  }

  async markRefreshUsed(hash: string): Promise<void> {
    this.usedRefresh.add(hash);
  }

  async wasRefreshUsed(hash: string): Promise<boolean> {
    return this.usedRefresh.has(hash);
  }
}

export class RedisCredentialStore implements CredentialStore {
  constructor(
    private redis: RedisLike,
    private prefix = "securelink:cred:",
  ) {}

  private accessKey(hash: string) {
    return `${this.prefix}a:${hash}`;
  }
  private refreshKey(hash: string) {
    return `${this.prefix}r:${hash}`;
  }
  private usedKey(hash: string) {
    return `${this.prefix}used:${hash}`;
  }

  async save(record: StoredCredentialRecord): Promise<void> {
    const payload = JSON.stringify(record);
    const ttl = Math.max(1, record.refreshExpiresAt - Date.now());
    await this.redis.set(this.accessKey(record.accessTokenHash), payload, "PX", ttl);
    await this.redis.set(this.refreshKey(record.refreshTokenHash), payload, "PX", ttl);
  }

  async getByAccessTokenHash(hash: string): Promise<StoredCredentialRecord | null> {
    const raw = await this.redis.get(this.accessKey(hash));
    return raw ? (JSON.parse(raw) as StoredCredentialRecord) : null;
  }

  async getByRefreshTokenHash(hash: string): Promise<StoredCredentialRecord | null> {
    const raw = await this.redis.get(this.refreshKey(hash));
    return raw ? (JSON.parse(raw) as StoredCredentialRecord) : null;
  }

  async revokeByAccessTokenHash(hash: string): Promise<void> {
    const record = await this.getByAccessTokenHash(hash);
    if (!record) return;
    await this.redis.del(
      this.accessKey(record.accessTokenHash),
      this.refreshKey(record.refreshTokenHash),
    );
  }

  async revokeByRefreshTokenHash(hash: string): Promise<void> {
    const record = await this.getByRefreshTokenHash(hash);
    if (!record) return;
    await this.redis.del(
      this.accessKey(record.accessTokenHash),
      this.refreshKey(record.refreshTokenHash),
    );
  }

  async markRefreshUsed(hash: string): Promise<void> {
    await this.redis.set(this.usedKey(hash), "1", "PX", this.refreshTtlHint());
  }

  async wasRefreshUsed(hash: string): Promise<boolean> {
    return (await this.redis.get(this.usedKey(hash))) != null;
  }

  private refreshTtlHint() {
    return 30 * 24 * 60 * 60 * 1000;
  }
}

export interface InstallationRecord {
  installationId: string;
  publicKey: string;
  registeredAt: number;
  platform?: ClientPlatform;
}

export interface InstallationStore {
  save(record: InstallationRecord): Promise<void>;
  get(installationId: string): Promise<InstallationRecord | null>;
  getByPublicKey(publicKey: string): Promise<InstallationRecord | null>;
}

export class MemoryInstallationStore implements InstallationStore {
  private byId = new Map<string, InstallationRecord>();
  private byPublic = new Map<string, InstallationRecord>();

  async save(record: InstallationRecord): Promise<void> {
    this.byId.set(record.installationId, record);
    this.byPublic.set(record.publicKey, record);
  }

  async get(installationId: string): Promise<InstallationRecord | null> {
    return this.byId.get(installationId) ?? null;
  }

  async getByPublicKey(publicKey: string): Promise<InstallationRecord | null> {
    return this.byPublic.get(publicKey) ?? null;
  }
}

export interface ChallengeRecord {
  challenge: string;
  expiresAt: number;
  platform?: ClientPlatform;
  consumed?: boolean;
}

export interface ChallengeStore {
  issue(record: ChallengeRecord): Promise<void>;
  consume(challenge: string): Promise<ChallengeRecord | null>;
}

export class MemoryChallengeStore implements ChallengeStore {
  private byChallenge = new Map<string, ChallengeRecord>();

  async issue(record: ChallengeRecord): Promise<void> {
    this.byChallenge.set(record.challenge, record);
  }

  async consume(challenge: string): Promise<ChallengeRecord | null> {
    const record = this.byChallenge.get(challenge);
    if (!record) return null;
    if (record.consumed || record.expiresAt < Date.now()) {
      this.byChallenge.delete(challenge);
      return null;
    }
    record.consumed = true;
    this.byChallenge.delete(challenge);
    return record;
  }
}

// ---------------------------------------------------------------------------
// Proof verification
// ---------------------------------------------------------------------------

export interface ProofVerifier {
  verify(
    proof: ProofMetadata,
    context: {
      platform: ClientPlatform;
      method?: string;
      path?: string;
      requestId?: string;
      timestamp?: number;
      body?: unknown;
    },
  ): Promise<boolean>;
}

/**
 * Production verifier:
 * - installation: Ed25519 signature vs registered public key
 * - app-attest / play-integrity: requires injected platform verifier
 * - allowInsecureDevMode: accepts non-empty proofs (local demos only)
 */
export class ProductionProofVerifier implements ProofVerifier {
  constructor(
    private options: {
      installations: InstallationStore;
      appAttestVerifier?: ProofVerifier;
      playIntegrityVerifier?: ProofVerifier;
      allowInsecureDevMode?: boolean;
    },
  ) {}

  async verify(
    proof: ProofMetadata,
    context: {
      platform: ClientPlatform;
      method?: string;
      path?: string;
      requestId?: string;
      timestamp?: number;
      body?: unknown;
    },
  ): Promise<boolean> {
    if (!proof.type || proof.type === "none") return false;
    if (!proof.proof) return false;

    if (proof.type === "installation") {
      // proof format: `${publicKey}.${signature}` ; challenge holds payload
      const [publicKey, signature] = proof.proof.split(".");
      if (!publicKey || !signature || !proof.challenge) return false;
      const install = await this.options.installations.getByPublicKey(publicKey);
      if (!install) return false;
      return verifySignedRequestProof({
        publicKey,
        payload: proof.challenge,
        signature,
      });
    }

    if (proof.type === "app-attest") {
      if (this.options.appAttestVerifier) {
        return this.options.appAttestVerifier.verify(proof, context);
      }
      if (this.options.allowInsecureDevMode) return proof.proof.length > 0;
      return false;
    }

    if (proof.type === "play-integrity") {
      if (this.options.playIntegrityVerifier) {
        return this.options.playIntegrityVerifier.verify(proof, context);
      }
      if (this.options.allowInsecureDevMode) return proof.proof.length > 0;
      return false;
    }

    return false;
  }
}

/** @deprecated use ProductionProofVerifier */
export class DefaultProofVerifier extends ProductionProofVerifier {
  constructor(installations: InstallationStore = new MemoryInstallationStore()) {
    super({ installations, allowInsecureDevMode: true });
  }
}

// ---------------------------------------------------------------------------
// Custom auth validator
// ---------------------------------------------------------------------------

export interface AuthorizationValidator {
  validate(
    authorization: AuthorizationMetadata,
  ): Promise<{ identity: ProtocolIdentity; valid: boolean }>;
}

/** Demo-only — any non-empty token becomes a user. Not for production. */
export class PassThroughAuthorizationValidator implements AuthorizationValidator {
  async validate(
    authorization: AuthorizationMetadata,
  ): Promise<{ identity: ProtocolIdentity; valid: boolean }> {
    const raw = authorization.authorization ?? authorization.token;
    if (!raw) return { identity: { id: "unknown", type: "user" }, valid: false };
    return {
      identity: { id: `user_${sha256(raw).slice(0, 16)}`, type: "user" },
      valid: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export interface CookieOptions {
  accessCookieName?: string;
  refreshCookieName?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  path?: string;
  domain?: string;
}

export interface SetCookieInstruction {
  name: string;
  value: string;
  maxAgeSec: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  path: string;
  domain?: string;
}

export function formatSetCookie(c: SetCookieInstruction): string {
  const parts = [
    `${c.name}=${encodeURIComponent(c.value)}`,
    `Max-Age=${c.maxAgeSec}`,
    `Path=${c.path}`,
    `SameSite=${c.sameSite}`,
  ];
  if (c.httpOnly) parts.push("HttpOnly");
  if (c.secure) parts.push("Secure");
  if (c.domain) parts.push(`Domain=${c.domain}`);
  return parts.join("; ");
}

export type CredentialDelivery = "bearer" | "cookie";

// ---------------------------------------------------------------------------
// Security context
// ---------------------------------------------------------------------------

export interface SecurityContext {
  identity: ProtocolIdentity;
  identityType: IdentityType;
  authMode: AuthMode;
  authorizationState: "anonymous" | "authenticated" | "none";
  clientPlatform: ClientPlatform;
  applicationInstallation?: string;
  deviceId?: string;
  requestMetadata: SecureLinkRequest["metadata"];
  proofVerificationResult: boolean;
  protocolVersion: ProtocolVersion;
  securityMetadata: Record<string, unknown>;
  ip?: string;
}

export interface SecureLinkServerConfig {
  authMode?: AuthMode | "both";
  attestation?: {
    enabled: boolean;
    verifier?: ProofVerifier;
    appAttestVerifier?: ProofVerifier;
    playIntegrityVerifier?: ProofVerifier;
  };
  rateLimit?: RateLimitConfig;
  credentials?: CredentialStore;
  installations?: InstallationStore;
  challenges?: ChallengeStore;
  authorizationValidator?: AuthorizationValidator;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  /** Pepper for hashing tokens at rest (required in production). */
  tokenHashSecret?: string;
  /** How anonymous credentials are returned to clients. Default bearer. */
  credentialDelivery?: CredentialDelivery;
  cookie?: CookieOptions;
  /**
   * LOCAL DEMOS ONLY. When true:
   * - missing platform attestation verifiers accept non-empty proofs
   * - PassThroughAuthorizationValidator may be used
   * Never enable in production.
   */
  allowInsecureDevMode?: boolean;
}

export interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
  method?: string;
  path?: string;
  /** Parsed Cookie header map (optional) */
  cookies?: Record<string, string>;
}

export interface BootstrapResult
  extends SecureLinkResponse<{
    identity: ProtocolIdentity;
    credentials: AuthorizationMetadata;
  }> {
  setCookies?: SetCookieInstruction[];
}

function header(headers: IncomingRequest["headers"], name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseCookieHeader(raw?: string): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

function parseEnvelope(body: unknown): SecureLinkRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as SecureLinkRequest;
  if (!b.metadata?.requestId) return null;
  return b;
}

function bearerToken(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? undefined;
}

export class SecureLinkServer {
  readonly rateLimit: RateLimitEngine;
  readonly credentials: CredentialStore;
  readonly installations: InstallationStore;
  readonly challenges: ChallengeStore;
  readonly proofVerifier: ProofVerifier;
  readonly authValidator: AuthorizationValidator | null;
  readonly attestationEnabled: boolean;
  readonly accessTokenTtlMs: number;
  readonly refreshTokenTtlMs: number;
  readonly configuredMode: AuthMode | "both";
  readonly tokenHashSecret: string;
  readonly credentialDelivery: CredentialDelivery;
  readonly cookieOptions: Required<
    Pick<CookieOptions, "accessCookieName" | "refreshCookieName" | "secure" | "httpOnly" | "sameSite" | "path">
  > &
    Pick<CookieOptions, "domain">;
  readonly allowInsecureDevMode: boolean;

  constructor(config: SecureLinkServerConfig = {}) {
    this.allowInsecureDevMode = config.allowInsecureDevMode === true;
    this.configuredMode = config.authMode ?? "both";
    this.attestationEnabled = config.attestation?.enabled ?? true;
    this.installations = config.installations ?? new MemoryInstallationStore();
    this.challenges = config.challenges ?? new MemoryChallengeStore();
    this.credentials = config.credentials ?? new MemoryCredentialStore();
    this.proofVerifier =
      config.attestation?.verifier ??
      new ProductionProofVerifier({
        installations: this.installations,
        appAttestVerifier: config.attestation?.appAttestVerifier,
        playIntegrityVerifier: config.attestation?.playIntegrityVerifier,
        allowInsecureDevMode: this.allowInsecureDevMode,
      });

    if (config.authorizationValidator) {
      this.authValidator = config.authorizationValidator;
    } else if (this.allowInsecureDevMode) {
      this.authValidator = new PassThroughAuthorizationValidator();
    } else if (this.configuredMode === "anonymous") {
      this.authValidator = null;
    } else {
      throw new ProtocolError(
        "PROTOCOL_INVALID",
        "authorizationValidator is required for customAuth in production (set allowInsecureDevMode only for local demos)",
        500,
      );
    }

    this.accessTokenTtlMs = config.accessTokenTtlMs ?? 15 * 60 * 1000;
    this.refreshTokenTtlMs = config.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.tokenHashSecret =
      config.tokenHashSecret ??
      (this.allowInsecureDevMode
        ? "dev-only-insecure-token-hash-secret"
        : (() => {
            throw new ProtocolError(
              "PROTOCOL_INVALID",
              "tokenHashSecret is required in production",
              500,
            );
          })());
    this.credentialDelivery = config.credentialDelivery ?? "bearer";
    this.cookieOptions = {
      accessCookieName: config.cookie?.accessCookieName ?? "sl_access",
      refreshCookieName: config.cookie?.refreshCookieName ?? "sl_refresh",
      secure: config.cookie?.secure ?? true,
      httpOnly: config.cookie?.httpOnly ?? true,
      sameSite: config.cookie?.sameSite ?? "Lax",
      path: config.cookie?.path ?? "/",
      domain: config.cookie?.domain,
    };
    this.rateLimit = new RateLimitEngine(
      config.rateLimit ?? {
        enabled: true,
        user: { max: 100, windowMs: 60_000 },
        device: { max: 50, windowMs: 60_000 },
        ip: { max: 200, windowMs: 60_000 },
        endpoint: { max: 60, windowMs: 60_000 },
      },
    );
  }

  private hash(token: string): string {
    return hashToken(token, this.tokenHashSecret);
  }

  private async enforceRateLimit(input: RateLimitCheckInput): Promise<void> {
    const rl = await this.rateLimit.check(input);
    if (!rl.allowed) {
      throw new ProtocolError("RATE_LIMITED", `rate limited by ${rl.limitedBy}`, 429, {
        limitedBy: rl.limitedBy,
        retryAfterMs: rl.retryAfterMs,
      });
    }
  }

  private issueTokens(identityId: string): {
    plaintext: IssuedCredentials;
    record: StoredCredentialRecord;
  } {
    const token = `atk_${secureRandom(24)}`;
    const refreshToken = `rtk_${secureRandom(32)}`;
    const expiresAt = Date.now() + this.accessTokenTtlMs;
    const refreshExpiresAt = Date.now() + this.refreshTokenTtlMs;
    return {
      plaintext: {
        token,
        refreshToken,
        scheme: this.credentialDelivery === "cookie" ? "cookie" : "bearer",
        identityId,
        expiresAt,
        refreshExpiresAt,
      },
      record: {
        accessTokenHash: this.hash(token),
        refreshTokenHash: this.hash(refreshToken),
        identityId,
        expiresAt,
        refreshExpiresAt,
      },
    };
  }

  private cookieInstructions(creds: IssuedCredentials): SetCookieInstruction[] {
    return [
      {
        name: this.cookieOptions.accessCookieName,
        value: creds.token,
        maxAgeSec: Math.floor(this.accessTokenTtlMs / 1000),
        httpOnly: this.cookieOptions.httpOnly,
        secure: this.cookieOptions.secure,
        sameSite: this.cookieOptions.sameSite,
        path: this.cookieOptions.path,
        domain: this.cookieOptions.domain,
      },
      {
        name: this.cookieOptions.refreshCookieName,
        value: creds.refreshToken,
        maxAgeSec: Math.floor(this.refreshTokenTtlMs / 1000),
        httpOnly: this.cookieOptions.httpOnly,
        secure: this.cookieOptions.secure,
        sameSite: this.cookieOptions.sameSite,
        path: this.cookieOptions.path,
        domain: this.cookieOptions.domain,
      },
    ];
  }

  private publicCredentials(creds: IssuedCredentials): AuthorizationMetadata {
    if (this.credentialDelivery === "cookie") {
      return { scheme: "cookie" };
    }
    return {
      token: creds.token,
      refreshToken: creds.refreshToken,
      scheme: "bearer",
    };
  }

  private async requireProof(
    req: IncomingRequest,
    envelope: SecureLinkRequest | null,
    platform: ClientPlatform,
  ): Promise<boolean> {
    if (!this.attestationEnabled) return true;

    const proof: ProofMetadata = envelope?.proof ?? {
      type: (header(req.headers, "x-securelink-proof-type") as ProofMetadata["type"]) ?? "none",
      proof: header(req.headers, "x-securelink-proof"),
      challenge: undefined,
    };

    // Web typically has no platform attestation
    if (platform === "web" && (!proof.type || proof.type === "none")) {
      return true;
    }

    if (!proof.type || proof.type === "none" || !proof.proof) {
      if (this.allowInsecureDevMode) return true;
      throw new ProtocolError("PROOF_REQUIRED", "platform proof required", 403);
    }

    const ok = await this.proofVerifier.verify(proof, {
      platform,
      method: req.method ?? envelope?.metadata.method,
      path: req.path ?? envelope?.metadata.path,
      requestId: envelope?.metadata.requestId,
      timestamp: envelope?.metadata.timestamp,
      body: envelope?.body,
    });
    if (!ok) {
      throw new ProtocolError("PROOF_INVALID", "platform proof verification failed", 403);
    }
    return true;
  }

  /** Issue a single-use attestation challenge (bind native proofs). */
  async createAttestationChallenge(req: IncomingRequest): Promise<
    SecureLinkResponse<{ challenge: string; expiresAt: number }>
  > {
    const platform =
      (header(req.headers, "x-securelink-platform") as ClientPlatform) ?? "unknown";
    await this.enforceRateLimit({
      ip: req.ip,
      endpoint: "POST /securelink/attestation/challenge",
    });
    const challenge = secureRandom(16);
    const expiresAt = Date.now() + 5 * 60 * 1000;
    await this.challenges.issue({ challenge, expiresAt, platform });
    return {
      ok: true,
      status: 200,
      protocolVersion: PROTOCOL_VERSION,
      requestId: "challenge",
      data: { challenge, expiresAt },
    };
  }

  /** Register extension/device installation public key (never private key). */
  async registerInstallation(
    req: IncomingRequest,
  ): Promise<SecureLinkResponse<{ installationId: string; publicKey: string }>> {
    const envelope = parseEnvelope(req.body);
    const platform =
      (header(req.headers, "x-securelink-platform") as ClientPlatform) ??
      envelope?.metadata.platform ??
      "extension";

    await this.enforceRateLimit({
      ip: req.ip,
      endpoint: "POST /securelink/attestation/register",
    });

    const body = (envelope?.body ?? req.body) as {
      installationId?: string;
      publicKey?: string;
    } | null;
    const publicKey =
      body?.publicKey ??
      header(req.headers, "x-securelink-installation-public-key");
    if (!publicKey || publicKey.length < 32) {
      return this.errorResponse(envelope, 400, "PROTOCOL_INVALID", "publicKey required");
    }

    const installationId =
      body?.installationId ??
      header(req.headers, "x-securelink-installation-id") ??
      `ext_${publicKey.slice(0, 24)}`;

    await this.installations.save({
      installationId,
      publicKey,
      registeredAt: Date.now(),
      platform,
    });

    return {
      ok: true,
      status: 200,
      protocolVersion: PROTOCOL_VERSION,
      requestId: envelope?.metadata.requestId ?? "register",
      data: { installationId, publicKey },
    };
  }

  async bootstrapAnonymous(req: IncomingRequest): Promise<BootstrapResult> {
    const envelope = parseEnvelope(req.body);
    const platform =
      (header(req.headers, "x-securelink-platform") as ClientPlatform) ?? "unknown";

    try {
      await this.enforceRateLimit({
        ip: req.ip,
        endpoint: "POST /securelink/anonymous/bootstrap",
      });
      await this.requireProof(req, envelope, platform);
    } catch (err) {
      if (err instanceof ProtocolError) {
        return this.errorResponse(envelope, err.status, err.code, err.message);
      }
      throw err;
    }

    // Always mint server-side identity — never trust client-supplied anon ids
    const identity: ProtocolIdentity = {
      id: `anon_${secureRandom(16)}`,
      type: "anonymous",
    };

    const { plaintext, record } = this.issueTokens(identity.id);
    await this.credentials.save(record);

    const result: BootstrapResult = {
      ok: true,
      status: 200,
      protocolVersion: PROTOCOL_VERSION,
      requestId: envelope?.metadata.requestId ?? "bootstrap",
      data: {
        identity,
        credentials: this.publicCredentials(plaintext),
      },
      identity,
      credentials: this.publicCredentials(plaintext),
    };

    if (this.credentialDelivery === "cookie") {
      result.setCookies = this.cookieInstructions(plaintext);
    }

    return result;
  }

  async refreshAnonymous(req: IncomingRequest): Promise<BootstrapResult> {
    const envelope = parseEnvelope(req.body);
    const cookies =
      req.cookies ?? parseCookieHeader(header(req.headers, "cookie"));

    try {
      await this.enforceRateLimit({
        ip: req.ip,
        endpoint: "POST /securelink/anonymous/refresh",
      });
    } catch (err) {
      if (err instanceof ProtocolError) {
        return this.errorResponse(envelope, err.status, err.code, err.message);
      }
      throw err;
    }

    const refreshToken =
      envelope?.authorization?.refreshToken ??
      (envelope?.body as { refreshToken?: string } | undefined)?.refreshToken ??
      cookies[this.cookieOptions.refreshCookieName];

    if (!refreshToken) {
      return this.errorResponse(envelope, 401, "CREDENTIAL_INVALID", "refresh token missing");
    }

    const refreshHash = this.hash(refreshToken);
    if (await this.credentials.wasRefreshUsed?.(refreshHash)) {
      return this.errorResponse(
        envelope,
        401,
        "CREDENTIAL_INVALID",
        "refresh token reuse detected",
      );
    }

    const existing = await this.credentials.getByRefreshTokenHash(refreshHash);
    if (!existing) {
      return this.errorResponse(envelope, 401, "CREDENTIAL_INVALID", "refresh token invalid");
    }
    if (existing.refreshExpiresAt < Date.now()) {
      await this.credentials.revokeByRefreshTokenHash(refreshHash);
      return this.errorResponse(envelope, 401, "CREDENTIAL_EXPIRED", "refresh token expired");
    }

    await this.credentials.markRefreshUsed?.(refreshHash);
    await this.credentials.revokeByRefreshTokenHash(refreshHash);
    const { plaintext, record } = this.issueTokens(existing.identityId);
    await this.credentials.save(record);

    const identity: ProtocolIdentity = {
      id: existing.identityId,
      type: "anonymous",
    };

    const result: BootstrapResult = {
      ok: true,
      status: 200,
      protocolVersion: PROTOCOL_VERSION,
      requestId: envelope?.metadata.requestId ?? "refresh",
      data: {
        identity,
        credentials: this.publicCredentials(plaintext),
      },
      credentials: this.publicCredentials(plaintext),
    };
    if (this.credentialDelivery === "cookie") {
      result.setCookies = this.cookieInstructions(plaintext);
    }
    return result;
  }

  async verify(req: IncomingRequest): Promise<SecurityContext> {
    const envelope = parseEnvelope(req.body);
    const cookies =
      req.cookies ?? parseCookieHeader(header(req.headers, "cookie"));
    const protocolVersion =
      header(req.headers, "x-securelink-protocol") ??
      envelope?.metadata.protocolVersion ??
      PROTOCOL_VERSION;

    if (!isProtocolCompatible(String(protocolVersion))) {
      throw new ProtocolError(
        "PROTOCOL_UNSUPPORTED_VERSION",
        `unsupported protocol version ${protocolVersion}`,
        400,
      );
    }

    const authMode = (header(req.headers, "x-securelink-auth-mode") ??
      envelope?.metadata.authMode ??
      "anonymous") as AuthMode;

    if (this.configuredMode !== "both" && this.configuredMode !== authMode) {
      throw new ProtocolError("PROTOCOL_INVALID", `auth mode ${authMode} not allowed`, 400);
    }

    const platform = (header(req.headers, "x-securelink-platform") ??
      envelope?.metadata.platform ??
      "unknown") as ClientPlatform;

    const method = req.method ?? envelope?.metadata.method ?? "GET";
    const path = req.path ?? envelope?.metadata.path ?? "/";

    const proofOk = await this.requireProof(req, envelope, platform);

    let identity: ProtocolIdentity;
    let authorizationState: SecurityContext["authorizationState"] = "none";

    if (authMode === "anonymous") {
      const token =
        envelope?.authorization?.token ??
        bearerToken(header(req.headers, "authorization")) ??
        cookies[this.cookieOptions.accessCookieName];

      if (!token) {
        throw new ProtocolError("UNAUTHORIZED", "missing access token", 401);
      }

      const creds = await this.credentials.getByAccessTokenHash(this.hash(token));
      if (!creds) {
        throw new ProtocolError("CREDENTIAL_INVALID", "invalid access token", 401);
      }
      if (creds.expiresAt < Date.now()) {
        throw new ProtocolError("CREDENTIAL_EXPIRED", "access token expired", 401);
      }

      identity = { id: creds.identityId, type: "anonymous" };
      authorizationState = "anonymous";
    } else {
      if (!this.authValidator) {
        throw new ProtocolError("UNAUTHORIZED", "customAuth validator not configured", 401);
      }
      const authorization: AuthorizationMetadata = envelope?.authorization ?? {
        authorization:
          header(req.headers, "x-securelink-authorization") ??
          header(req.headers, "authorization"),
        token: bearerToken(header(req.headers, "authorization")),
        scheme: "custom",
      };

      const result = await this.authValidator.validate(authorization);
      if (!result.valid) {
        throw new ProtocolError("UNAUTHORIZED", "user authorization invalid", 401);
      }
      identity = result.identity;
      authorizationState = "authenticated";
    }

    const endpoint = `${method.toUpperCase()} ${path}`;
    await this.enforceRateLimit({
      userId: identity.type === "user" ? identity.id : undefined,
      anonymousId: identity.type === "anonymous" ? identity.id : undefined,
      deviceId: envelope?.identity?.type === "device" ? envelope.identity.id : undefined,
      installationId:
        header(req.headers, "x-securelink-installation-id") ??
        (envelope?.identity?.type === "installation" ? envelope.identity.id : undefined),
      ip: req.ip,
      endpoint,
    });

    return {
      identity,
      identityType: identity.type,
      authMode,
      authorizationState,
      clientPlatform: platform,
      applicationInstallation: header(req.headers, "x-securelink-installation-id"),
      requestMetadata: envelope?.metadata ?? {
        requestId: header(req.headers, "x-securelink-request-id") ?? "unknown",
        timestamp: Date.now(),
        method,
        path,
        platform,
        authMode,
        protocolVersion,
      },
      proofVerificationResult: proofOk,
      protocolVersion,
      securityMetadata: { rateLimitChecked: true },
      ip: req.ip,
    };
  }

  createMiddleware() {
    return async (
      req: IncomingRequest,
      helpers: {
        onSuccess: (ctx: SecurityContext) => void | Promise<void>;
        onError: (
          status: number,
          body: SecureLinkResponse,
          extraHeaders?: Record<string, string>,
        ) => void | Promise<void>;
      },
    ) => {
      try {
        const ctx = await this.verify(req);
        await helpers.onSuccess(ctx);
      } catch (err) {
        if (err instanceof ProtocolError) {
          const extra: Record<string, string> = {};
          if (err.code === "RATE_LIMITED" && err.details?.retryAfterMs) {
            extra["Retry-After"] = String(
              Math.ceil(Number(err.details.retryAfterMs) / 1000),
            );
          }
          await helpers.onError(
            err.status,
            {
              ok: false,
              status: err.status,
              protocolVersion: PROTOCOL_VERSION,
              requestId: header(req.headers, "x-securelink-request-id") ?? "unknown",
              error: { code: err.code, message: err.message, details: err.details },
            },
            extra,
          );
          return;
        }
        await helpers.onError(500, {
          ok: false,
          status: 500,
          protocolVersion: PROTOCOL_VERSION,
          requestId: "unknown",
          error: { code: "INTERNAL", message: "internal error" },
        });
      }
    };
  }

  private errorResponse<T = unknown>(
    envelope: SecureLinkRequest | null,
    status: number,
    code: ProtocolError["code"],
    message: string,
  ): SecureLinkResponse<T> {
    return {
      ok: false,
      status,
      protocolVersion: PROTOCOL_VERSION,
      requestId: envelope?.metadata.requestId ?? "unknown",
      error: { code, message },
    };
  }
}

export function createSecureLinkServer(config?: SecureLinkServerConfig): SecureLinkServer {
  return new SecureLinkServer(config);
}

export {
  PROTOCOL_VERSION,
  ProtocolError,
  type AuthMode,
  type ProtocolIdentity,
  type SecureLinkRequest,
  type SecureLinkResponse,
};
