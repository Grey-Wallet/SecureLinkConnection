import type { StorageAdapter } from "@securelink/core";

/** In-memory only — tests. Not for production tokens. */
export class SecureMemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
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

/** Minimal surface of react-native-keychain used by {@link KeychainStorage}. */
export interface KeychainModule {
  setGenericPassword(
    username: string,
    password: string,
    options?: {
      service?: string;
      accessible?: string;
      accessControl?: string;
      securityLevel?: string;
    },
  ): Promise<false | { service: string; storage?: string }>;
  getGenericPassword(options?: {
    service?: string;
  }): Promise<false | { username: string; password: string; service: string }>;
  resetGenericPassword(options?: { service?: string }): Promise<boolean>;
  ACCESSIBLE?: { WHEN_UNLOCKED_THIS_DEVICE_ONLY?: string; WHEN_UNLOCKED?: string };
  ACCESS_CONTROL?: { BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE?: string };
  SECURITY_LEVEL?: { SECURE_HARDWARE?: string; SECURE_SOFTWARE?: string };
}

/**
 * iOS Keychain / Android Keystore via `react-native-keychain`.
 * Uses WHEN_UNLOCKED_THIS_DEVICE_ONLY when the module exposes it.
 */
export class KeychainStorage implements StorageAdapter {
  private tracked = new Set<string>();

  constructor(
    private keychain: KeychainModule,
    private service = "securelink",
  ) {}

  private serviceFor(key: string): string {
    return `${this.service}:${key}`;
  }

  async get(key: string): Promise<string | null> {
    const result = await this.keychain.getGenericPassword({
      service: this.serviceFor(key),
    });
    if (!result) return null;
    return result.password;
  }

  async set(key: string, value: string): Promise<void> {
    const accessible =
      this.keychain.ACCESSIBLE?.WHEN_UNLOCKED_THIS_DEVICE_ONLY ??
      this.keychain.ACCESSIBLE?.WHEN_UNLOCKED;
    await this.keychain.setGenericPassword("securelink", value, {
      service: this.serviceFor(key),
      ...(accessible ? { accessible } : {}),
      ...(this.keychain.SECURITY_LEVEL?.SECURE_HARDWARE
        ? { securityLevel: this.keychain.SECURITY_LEVEL.SECURE_HARDWARE }
        : {}),
    });
    this.tracked.add(key);
  }

  async remove(key: string): Promise<void> {
    await this.keychain.resetGenericPassword({ service: this.serviceFor(key) });
    this.tracked.delete(key);
  }

  async clear(): Promise<void> {
    await this.keychain.resetGenericPassword({ service: this.service });
    for (const key of [...this.tracked, "identity", "credentials"]) {
      await this.keychain.resetGenericPassword({ service: this.serviceFor(key) });
    }
    this.tracked.clear();
  }
}

export interface SecureStoreModule {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class SecureStoreStorage implements StorageAdapter {
  private tracked = new Set<string>();

  constructor(
    private secureStore: SecureStoreModule,
    private prefix = "securelink",
  ) {}

  private k(key: string): string {
    return `${this.prefix}.${key}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  async get(key: string): Promise<string | null> {
    return this.secureStore.getItemAsync(this.k(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.secureStore.setItemAsync(this.k(key), value);
    this.tracked.add(key);
  }

  async remove(key: string): Promise<void> {
    await this.secureStore.deleteItemAsync(this.k(key));
    this.tracked.delete(key);
  }

  async clear(): Promise<void> {
    for (const key of [...this.tracked, "identity", "credentials"]) {
      await this.secureStore.deleteItemAsync(this.k(key));
    }
    this.tracked.clear();
  }
}

export function createKeychainStorage(
  keychain: KeychainModule,
  service = "securelink",
): StorageAdapter {
  return new KeychainStorage(keychain, service);
}

export function createSecureStoreStorage(
  secureStore: SecureStoreModule,
  prefix = "securelink",
): StorageAdapter {
  return new SecureStoreStorage(secureStore, prefix);
}

export interface ResolveNativeStorageOptions {
  /** Explicit adapter wins. */
  secureStorage?: StorageAdapter;
  /**
   * LOCAL DEMOS / TESTS ONLY.
   * When false (default), missing keychain throws instead of falling back to memory.
   */
  allowInsecureMemoryStorage?: boolean;
  service?: string;
}

/**
 * Resolve platform secure storage.
 * Production: requires react-native-keychain (or explicit secureStorage).
 */
export function resolveNativeSecureStorage(
  options: ResolveNativeStorageOptions = {},
): StorageAdapter {
  if (options.secureStorage) return options.secureStorage;

  try {
    // Optional peer — apps install react-native-keychain for production.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Keychain = require("react-native-keychain") as KeychainModule;
    return new KeychainStorage(Keychain, options.service ?? "securelink");
  } catch {
    if (options.allowInsecureMemoryStorage) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "[@securelink/react-native] using in-memory storage (allowInsecureMemoryStorage). Not for production.",
        );
      }
      return new SecureMemoryStorage();
    }
    throw new Error(
      "[@securelink/react-native] Secure storage required. Install react-native-keychain " +
        "or pass secureStorage (Keychain / Expo SecureStore). " +
        "Set allowInsecureMemoryStorage: true only for local demos.",
    );
  }
}
