import type {
  AuthMode,
  AuthorizationMetadata,
  ClientPlatform,
  ProofMetadata,
  ProtocolIdentity,
  SecureLinkRequest,
  SecureLinkResponse,
} from "@securelink/protocol";
import {
  PROTOCOL_VERSION,
  ProtocolError,
  createRequestId,
} from "@securelink/protocol";
import { secureRandom } from "@securelink/crypto";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Authorization (customAuth)
// ---------------------------------------------------------------------------

export interface AuthorizationProvider {
  /** Return current app authorization material, or null if not authorized */
  getAuthorization(): Promise<AuthorizationMetadata | null>;
  /** Called when server indicates auth must be refreshed / re-run */
  onUnauthorized?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Attestation / platform proof
// ---------------------------------------------------------------------------

export interface AttestationProvider {
  /** Produce platform proof for bootstrap or request */
  getProof(challenge?: string): Promise<ProofMetadata>;
}

export class NoopAttestationProvider implements AttestationProvider {
  async getProof(): Promise<ProofMetadata> {
    return { type: "none" };
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: "omit" | "same-origin" | "include";
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface Transport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type StorageMode = "memory" | "persistent" | StorageAdapter;

export interface SecureLinkClientConfig {
  baseUrl: string;
  authMode: AuthMode;
  platform: ClientPlatform;
  /** Platform attestation / installation proof — default enabled for mobile/extension callers */
  attestation?: {
    enabled: boolean;
    provider?: AttestationProvider;
  };
  storage?: StorageMode;
  /** Required when authMode === 'customAuth' */
  authorization?: AuthorizationProvider;
  transport?: Transport;
  /** Prefix for storage keys */
  storagePrefix?: string;
  /**
   * How anonymous credentials are carried.
   * - bearer (default): tokens in secure client storage + Authorization header
   * - cookie: HttpOnly cookies from server; client stores identity only
   */
  credentialDelivery?: "bearer" | "cookie";
}

export interface ResolvedClientConfig {
  baseUrl: string;
  authMode: AuthMode;
  platform: ClientPlatform;
  attestationEnabled: boolean;
  attestationProvider: AttestationProvider;
  storage: StorageAdapter;
  authorization?: AuthorizationProvider;
  transport: Transport;
  storagePrefix: string;
  credentialDelivery: "bearer" | "cookie";
}

function resolveStorage(mode: StorageMode | undefined): StorageAdapter {
  if (!mode || mode === "memory") return new MemoryStorage();
  if (mode === "persistent") {
    throw new ProtocolError(
      "INTERNAL",
      "persistent storage requires a platform adapter; pass a StorageAdapter",
      500,
    );
  }
  return mode;
}

export function resolveConfig(config: SecureLinkClientConfig): ResolvedClientConfig {
  if (config.authMode === "customAuth" && !config.authorization) {
    throw new ProtocolError(
      "PROTOCOL_INVALID",
      "authorization provider is required when authMode is customAuth",
      400,
    );
  }

  const attestationEnabled = config.attestation?.enabled ?? false;

  return {
    baseUrl: config.baseUrl.replace(/\/$/, ""),
    authMode: config.authMode,
    platform: config.platform,
    attestationEnabled,
    attestationProvider:
      config.attestation?.provider ?? new NoopAttestationProvider(),
    storage: resolveStorage(config.storage),
    authorization: config.authorization,
    transport: config.transport ?? createFetchTransport(),
    storagePrefix: config.storagePrefix ?? "securelink",
    credentialDelivery: config.credentialDelivery ?? "bearer",
  };
}

export function createFetchTransport(): Transport {
  return {
    async send(req) {
      const method = req.method.toUpperCase();
      const canHaveBody = method !== "GET" && method !== "HEAD";
      const init: {
        method: string;
        headers: Record<string, string>;
        credentials: "omit" | "same-origin" | "include";
        body?: string;
      } = {
        method: req.method,
        headers: {
          ...(canHaveBody ? { "content-type": "application/json" } : {}),
          ...req.headers,
        },
        credentials: req.credentials ?? "include",
      };
      // Browsers reject GET/HEAD with a body — auth goes in headers instead.
      if (canHaveBody && req.body !== undefined) {
        init.body = JSON.stringify(req.body);
      }
      const res = await fetch(req.url, init);
      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, headers, body };
    },
  };
}

// ---------------------------------------------------------------------------
// Credential + identity session
// ---------------------------------------------------------------------------

const IDENTITY_KEY = "identity";
const CREDENTIALS_KEY = "credentials";

export interface SessionState {
  identity: ProtocolIdentity | null;
  credentials: AuthorizationMetadata | null;
}

export class SessionStore {
  constructor(
    private storage: StorageAdapter,
    private prefix: string,
  ) {}

  private key(name: string): string {
    return `${this.prefix}:${name}`;
  }

  async get(): Promise<SessionState> {
    const identityRaw = await this.storage.get(this.key(IDENTITY_KEY));
    const credsRaw = await this.storage.get(this.key(CREDENTIALS_KEY));
    let identity: ProtocolIdentity | null = null;
    let credentials: AuthorizationMetadata | null = null;
    try {
      identity = identityRaw ? (JSON.parse(identityRaw) as ProtocolIdentity) : null;
    } catch {
      await this.storage.remove(this.key(IDENTITY_KEY));
    }
    try {
      credentials = credsRaw
        ? (JSON.parse(credsRaw) as AuthorizationMetadata)
        : null;
    } catch {
      await this.storage.remove(this.key(CREDENTIALS_KEY));
    }
    return { identity, credentials };
  }

  async setIdentity(identity: ProtocolIdentity | null): Promise<void> {
    if (!identity) {
      await this.storage.remove(this.key(IDENTITY_KEY));
      return;
    }
    await this.storage.set(this.key(IDENTITY_KEY), JSON.stringify(identity));
  }

  async setCredentials(credentials: AuthorizationMetadata | null): Promise<void> {
    if (!credentials) {
      await this.storage.remove(this.key(CREDENTIALS_KEY));
      return;
    }
    await this.storage.set(this.key(CREDENTIALS_KEY), JSON.stringify(credentials));
  }

  async clear(): Promise<void> {
    await this.storage.remove(this.key(IDENTITY_KEY));
    await this.storage.remove(this.key(CREDENTIALS_KEY));
  }
}

export function createAnonymousIdentity(): ProtocolIdentity {
  return {
    id: `anon_${secureRandom(16)}`,
    type: "anonymous",
  };
}

// ---------------------------------------------------------------------------
// Client core / request pipeline
// ---------------------------------------------------------------------------

export interface ApiRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class SecureLinkClient {
  readonly config: ResolvedClientConfig;
  readonly session: SessionStore;
  private ready = false;
  private refreshInflight: Promise<void> | null = null;

  constructor(config: SecureLinkClientConfig) {
    this.config = resolveConfig(config);
    this.session = new SessionStore(this.config.storage, this.config.storagePrefix);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Drop local session (used after logout or invalid server tokens). */
  async clearSession(): Promise<void> {
    await this.session.clear();
    this.ready = false;
  }

  /**
   * Bootstrap SecureLink session.
   * - anonymous: create identity + obtain credentials from server
   * - customAuth: skip anonymous identity; still collect platform proof when enabled
   * @param force when true, ignore cached anonymous credentials and bootstrap again
   */
  async initialize(force = false): Promise<void> {
    const proof = this.config.attestationEnabled
      ? await this.config.attestationProvider.getProof()
      : undefined;

    if (this.config.authMode === "anonymous") {
      if (force) {
        await this.session.clear();
        this.ready = false;
      }

      let { identity, credentials } = await this.session.get();
      if (!identity) {
        identity = createAnonymousIdentity();
        await this.session.setIdentity(identity);
      }

      if (!credentials?.token) {
        const bootstrap = await this.sendEnvelope<SecureLinkResponse<{
          identity: ProtocolIdentity;
          credentials: AuthorizationMetadata;
        }>>({
          method: "POST",
          path: "/securelink/anonymous/bootstrap",
          identity,
          proof,
          body: { identity },
        });

        if (!bootstrap.ok || !bootstrap.data) {
          throw new ProtocolError(
            bootstrap.error?.code ?? "INTERNAL",
            bootstrap.error?.message ?? "anonymous bootstrap failed",
            bootstrap.status,
          );
        }

        await this.session.setIdentity(bootstrap.data.identity);
        // Cookie mode: never persist access/refresh tokens in JS storage
        if (this.config.credentialDelivery === "cookie") {
          await this.session.setCredentials({ scheme: "cookie" });
        } else {
          await this.session.setCredentials(bootstrap.data.credentials);
        }
      }
    } else {
      // customAuth: do not create anonymous identity
      await this.session.setIdentity(null);
      const auth = await this.config.authorization!.getAuthorization();
      if (!auth) {
        throw new ProtocolError("UNAUTHORIZED", "user is not authorized", 401);
      }
      await this.session.setCredentials(auth);

      // Optional: register device/installation proof with server without anon identity
      if (this.config.attestationEnabled && proof?.proof) {
        const reg = await this.sendEnvelope<SecureLinkResponse>({
          method: "POST",
          path: "/securelink/attestation/register",
          proof,
          authorization: auth,
          body: { proof },
        });
        if (!reg.ok) {
          throw new ProtocolError(
            reg.error?.code ?? "PROOF_INVALID",
            reg.error?.message ?? "attestation registration failed",
            reg.status,
          );
        }
      }
    }

    this.ready = true;
  }

  async request<T = unknown>(options: ApiRequestOptions): Promise<SecureLinkResponse<T>> {
    if (!this.ready) {
      await this.initialize();
    }

    const session = await this.session.get();
    let authorization = session.credentials;

    if (this.config.authMode === "customAuth") {
      authorization =
        (await this.config.authorization!.getAuthorization()) ?? authorization;
    }

    const proof = this.config.attestationEnabled
      ? await this.config.attestationProvider.getProof()
      : undefined;

    let response = await this.sendEnvelope<SecureLinkResponse<T>>({
      method: options.method ?? "GET",
      path: options.path,
      body: options.body,
      headers: options.headers,
      identity: this.config.authMode === "anonymous" ? session.identity ?? undefined : undefined,
      authorization: authorization ?? undefined,
      proof,
    });

    // Anonymous: expired → refresh; invalid/unknown (e.g. server restart) → re-bootstrap
    if (
      this.config.authMode === "anonymous" &&
      response.status === 401 &&
      (response.error?.code === "CREDENTIAL_EXPIRED" ||
        response.error?.code === "CREDENTIAL_INVALID" ||
        response.error?.code === "UNAUTHORIZED")
    ) {
      if (response.error?.code === "CREDENTIAL_EXPIRED") {
        await this.refreshAnonymousSingleFlight(proof);
      } else {
        await this.session.clear();
        this.ready = false;
        await this.initialize(true);
      }
      const refreshed = await this.session.get();
      response = await this.sendEnvelope<SecureLinkResponse<T>>({
        method: options.method ?? "GET",
        path: options.path,
        body: options.body,
        headers: options.headers,
        identity: refreshed.identity ?? undefined,
        authorization: refreshed.credentials ?? undefined,
        proof,
      });
    }

    if (
      this.config.authMode === "customAuth" &&
      response.status === 401 &&
      this.config.authorization?.onUnauthorized
    ) {
      await this.config.authorization.onUnauthorized();
    }

    if (response.credentials) {
      if (this.config.credentialDelivery === "cookie") {
        await this.session.setCredentials({ scheme: "cookie" });
      } else {
        await this.session.setCredentials(response.credentials);
      }
    }
    if (response.identity && this.config.authMode === "anonymous") {
      await this.session.setIdentity(response.identity);
    }

    return response;
  }

  private async refreshAnonymousSingleFlight(proof?: ProofMetadata): Promise<void> {
    if (this.refreshInflight) {
      await this.refreshInflight;
      return;
    }
    this.refreshInflight = this.refreshAnonymous(proof).finally(() => {
      this.refreshInflight = null;
    });
    await this.refreshInflight;
  }

  private async refreshAnonymous(proof?: ProofMetadata): Promise<void> {
    const session = await this.session.get();
    const needsBearerRefresh =
      this.config.credentialDelivery !== "cookie" && !session.credentials?.refreshToken;

    if (needsBearerRefresh) {
      await this.session.clear();
      this.ready = false;
      await this.initialize();
      return;
    }

    const response = await this.sendEnvelope<SecureLinkResponse<{
      credentials: AuthorizationMetadata;
    }>>({
      method: "POST",
      path: "/securelink/anonymous/refresh",
      identity: session.identity ?? undefined,
      authorization: session.credentials ?? { scheme: "cookie" },
      proof,
      body:
        this.config.credentialDelivery === "cookie"
          ? {}
          : { refreshToken: session.credentials?.refreshToken },
    });

    if (!response.ok || !response.data?.credentials) {
      await this.session.clear();
      this.ready = false;
      await this.initialize();
      return;
    }

    if (this.config.credentialDelivery === "cookie") {
      await this.session.setCredentials({ scheme: "cookie" });
    } else {
      await this.session.setCredentials(response.data.credentials);
    }
  }

  private async sendEnvelope<T>(input: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
    identity?: ProtocolIdentity;
    authorization?: AuthorizationMetadata;
    proof?: ProofMetadata;
  }): Promise<T> {
    const requestId = createRequestId();
    const useCookie =
      this.config.credentialDelivery === "cookie" &&
      this.config.authMode === "anonymous" &&
      (input.authorization?.scheme === "cookie" ||
        !input.authorization?.token);

    const authorizationForEnvelope = useCookie
      ? { scheme: "cookie" as const }
      : input.authorization;

    const envelope: SecureLinkRequest = {
      metadata: {
        requestId,
        timestamp: Date.now(),
        method: input.method,
        path: input.path,
        platform: this.config.platform,
        authMode: this.config.authMode,
        protocolVersion: PROTOCOL_VERSION,
      },
      identity: input.identity,
      authorization: authorizationForEnvelope,
      proof: input.proof,
      body: input.body,
      headers: input.headers,
    };

    const headers: Record<string, string> = {
      "x-securelink-protocol": PROTOCOL_VERSION,
      "x-securelink-request-id": requestId,
      "x-securelink-auth-mode": this.config.authMode,
      "x-securelink-platform": this.config.platform,
      ...input.headers,
    };

    if (!useCookie) {
      if (input.authorization?.token) {
        headers.authorization = `Bearer ${input.authorization.token}`;
      } else if (input.authorization?.authorization) {
        headers.authorization = input.authorization.authorization;
        headers["x-securelink-authorization"] = input.authorization.authorization;
      }
    }

    if (input.proof?.proof) {
      headers["x-securelink-proof"] = input.proof.proof;
      if (input.proof.type) headers["x-securelink-proof-type"] = input.proof.type;
    }

    const method = input.method.toUpperCase();
    const canHaveBody = method !== "GET" && method !== "HEAD";

    const transportRes = await this.config.transport.send({
      url: `${this.config.baseUrl}${input.path.startsWith("/") ? input.path : `/${input.path}`}`,
      method: input.method,
      headers,
      body: canHaveBody ? envelope : undefined,
      credentials: "include",
    });

    if (
      transportRes.body &&
      typeof transportRes.body === "object" &&
      "ok" in (transportRes.body as object)
    ) {
      return transportRes.body as T;
    }

    return {
      ok: transportRes.status >= 200 && transportRes.status < 300,
      status: transportRes.status,
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      data: transportRes.body,
    } as T;
  }
}

export function createSecureLinkClient(config: SecureLinkClientConfig): SecureLinkClient {
  return new SecureLinkClient(config);
}

export {
  PROTOCOL_VERSION,
  ProtocolError,
  createRequestId,
  type AuthMode,
  type AuthorizationMetadata,
  type ClientPlatform,
  type ProofMetadata,
  type ProtocolIdentity,
  type SecureLinkRequest,
  type SecureLinkResponse,
};
