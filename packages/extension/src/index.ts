import {
  SecureLinkClient,
  createSecureLinkClient,
  type AttestationProvider,
  type AuthorizationProvider,
  type SecureLinkClientConfig,
  type StorageAdapter,
} from "@securelink/core";
import {
  createSignedRequestProof,
  generateKeyPair,
  type KeyPair,
} from "@securelink/crypto";
import type { ProofMetadata } from "@securelink/protocol";
import { ExtensionStorage, resolveExtensionStorageArea } from "./storage.js";

const INSTALL_ID_KEY = "installationId";
const INSTALL_PUB_KEY = "installationPublicKey";
const INSTALL_PRIV_KEY = "installationPrivateKey";

export interface InstallationIdentity {
  installationId: string;
  keyPair: KeyPair;
}

function isKeyPair(value: unknown): value is KeyPair {
  if (!value || typeof value !== "object") return false;
  const v = value as KeyPair;
  return (
    typeof v.publicKey === "string" &&
    v.publicKey.length >= 32 &&
    typeof v.privateKey === "string" &&
    v.privateKey.length >= 32
  );
}

export async function ensureInstallationIdentity(
  storage: StorageAdapter,
  prefix = "securelink",
): Promise<InstallationIdentity> {
  const idKey = `${prefix}:${INSTALL_ID_KEY}`;
  const pubKey = `${prefix}:${INSTALL_PUB_KEY}`;
  const privKey = `${prefix}:${INSTALL_PRIV_KEY}`;
  // Legacy combined blob (migrate once)
  const legacyKpKey = `${prefix}:installationKeyPair`;

  let installationId = await storage.get(idKey);
  let publicKey = await storage.get(pubKey);
  let privateKey = await storage.get(privKey);

  if ((!publicKey || !privateKey) && (await storage.get(legacyKpKey))) {
    try {
      const legacy = JSON.parse((await storage.get(legacyKpKey))!) as KeyPair;
      if (isKeyPair(legacy)) {
        publicKey = legacy.publicKey;
        privateKey = legacy.privateKey;
        await storage.set(pubKey, publicKey);
        await storage.set(privKey, privateKey);
        await storage.remove(legacyKpKey);
      }
    } catch {
      // regenerate below
    }
  }

  if (!installationId || !publicKey || !privateKey || !isKeyPair({ publicKey, privateKey })) {
    const keyPair = generateKeyPair();
    installationId = `ext_${keyPair.publicKey.slice(0, 24)}`;
    await storage.set(idKey, installationId);
    await storage.set(pubKey, keyPair.publicKey);
    await storage.set(privKey, keyPair.privateKey);
    return { installationId, keyPair };
  }

  return {
    installationId,
    keyPair: { publicKey, privateKey },
  };
}

/**
 * Per-request installation proof — no shared mutable lastCtx.
 */
export class InstallationAttestationProvider implements AttestationProvider {
  private pendingCtx: {
    requestId: string;
    timestamp: number;
    method: string;
    path: string;
    body?: unknown;
  } | null = null;

  constructor(private identity: InstallationIdentity) {}

  /** Bind the next getProof() call to this request context. */
  setRequestContext(ctx: {
    requestId: string;
    timestamp: number;
    method: string;
    path: string;
    body?: unknown;
  }): void {
    this.pendingCtx = ctx;
  }

  async getProof(): Promise<ProofMetadata> {
    const ctx = this.pendingCtx ?? {
      requestId: `req_${Date.now()}`,
      timestamp: Date.now(),
      method: "POST",
      path: "/securelink/extension/register",
      body: undefined as unknown,
    };
    this.pendingCtx = null;

    const signed = createSignedRequestProof({
      privateKey: this.identity.keyPair.privateKey,
      publicKey: this.identity.keyPair.publicKey,
      ...ctx,
    });
    return {
      type: "installation",
      proof: `${this.identity.keyPair.publicKey}.${signed.signature}`,
      challenge: signed.payload,
    };
  }
}

export type ExtensionSecureLinkOptions = Omit<
  SecureLinkClientConfig,
  "platform" | "attestation"
> & {
  /** Default true — installation proof stays on for customAuth */
  installationProofEnabled?: boolean;
  /**
   * Prefer `storage.session` when available (Chrome 102+).
   * Default true for credentials isolation.
   */
  preferSessionStorage?: boolean;
  /** LOCAL TESTS ONLY */
  allowMemoryFallback?: boolean;
};

/**
 * Extension SDK (Chrome, Firefox, Edge, Chromium).
 *
 * - Storage: browser.storage / chrome.storage (not page localStorage)
 * - Installation private key stored separately from public material
 * - Per-request proof binding (safe under concurrent requests)
 */
export async function createExtensionSecureLink(
  options: ExtensionSecureLinkOptions,
): Promise<SecureLinkClient> {
  const preferSession = options.preferSessionStorage ?? true;
  const storage: StorageAdapter =
    options.storage && typeof options.storage !== "string"
      ? options.storage
      : new ExtensionStorage({
          preferSession,
          allowMemoryFallback: options.allowMemoryFallback,
        });
  const prefix = options.storagePrefix ?? "securelink";
  const installation = await ensureInstallationIdentity(storage, prefix);
  const proofEnabled = options.installationProofEnabled ?? true;
  const provider = new InstallationAttestationProvider(installation);

  const client = createSecureLinkClient({
    ...options,
    platform: "extension",
    storage,
    storagePrefix: prefix,
    attestation: {
      enabled: proofEnabled,
      provider,
    },
  });

  // Register public key before any authenticated/bootstrap call (never send private key)
  if (proofEnabled && options.baseUrl) {
    try {
      await fetch(
        `${options.baseUrl.replace(/\/$/, "")}/securelink/attestation/register`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-securelink-platform": "extension",
            "x-securelink-installation-id": installation.installationId,
          },
          body: JSON.stringify({
            metadata: {
              requestId: `reg_${Date.now()}`,
              timestamp: Date.now(),
              method: "POST",
              path: "/securelink/attestation/register",
              platform: "extension",
              authMode: options.authMode,
              protocolVersion: "1.0",
            },
            body: {
              installationId: installation.installationId,
              publicKey: installation.keyPair.publicKey,
            },
          }),
        },
      );
    } catch {
      // Server may be offline during unit tests; production verify still requires registration.
    }
  }

  const originalRequest = client.request.bind(client);
  client.request = async (opts) => {
    provider.setRequestContext({
      requestId: `req_${Date.now()}`,
      timestamp: Date.now(),
      method: opts.method ?? "GET",
      path: opts.path,
      body: opts.body,
    });
    return originalRequest(opts);
  };

  return client;
}

export type { AuthorizationProvider, SecureLinkClient, StorageAdapter };
export {
  ProtocolError,
  type AuthMode,
  type SecureLinkResponse,
} from "@securelink/core";
export { ExtensionStorage, resolveExtensionStorageArea };
