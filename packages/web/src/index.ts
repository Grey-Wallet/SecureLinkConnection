import {
  SecureLinkClient,
  createSecureLinkClient,
  MemoryStorage,
  type AuthorizationProvider,
  type SecureLinkClientConfig,
  type StorageAdapter,
} from "@securelink/core";
import { BrowserStorage, SecureWebStorage } from "./storage.js";

export type WebSecureLinkOptions = Omit<SecureLinkClientConfig, "platform"> & {
  /**
   * Persist SecureLink session with {@link SecureWebStorage} (default true).
   * Set false for memory-only (lost on refresh).
   * With `credentialDelivery: "cookie"`, only identity is persisted — tokens stay HttpOnly.
   */
  persistent?: boolean;
};

/**
 * Create a SecureLink client for web apps.
 *
 * Production defaults:
 * - Session vault: {@link SecureWebStorage} (AES-GCM + IndexedDB)
 * - Prefer `credentialDelivery: "cookie"` so access/refresh tokens are HttpOnly
 *
 * customAuth: your app owns the login token via `authorization.getAuthorization()`.
 */
export function createWebSecureLink(options: WebSecureLinkOptions): SecureLinkClient {
  const persistent = options.persistent ?? true;

  let storage: StorageAdapter | undefined;
  if (options.storage && typeof options.storage !== "string") {
    storage = options.storage;
  } else if (options.storage === "memory" || persistent === false) {
    storage = new MemoryStorage();
  } else {
    storage = new SecureWebStorage(options.storagePrefix ?? "securelink");
  }

  return createSecureLinkClient({
    ...options,
    platform: "web",
    storage,
    credentialDelivery: options.credentialDelivery ?? "bearer",
    attestation: options.attestation ?? { enabled: false },
  });
}

export type { AuthorizationProvider, SecureLinkClient, StorageAdapter };
export {
  MemoryStorage,
  ProtocolError,
  type AuthMode,
  type SecureLinkResponse,
} from "@securelink/core";
export { BrowserStorage, SecureWebStorage };
