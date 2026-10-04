import type { StorageAdapter } from "@securelink/core";

/**
 * Legacy plain Web Storage (localStorage / sessionStorage).
 * Not secure against XSS — prefer {@link SecureWebStorage}.
 */
export class BrowserStorage implements StorageAdapter {
  constructor(private area: Storage = globalThis.localStorage) {}

  async get(key: string): Promise<string | null> {
    try {
      return this.area.getItem(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.area.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    this.area.removeItem(key);
  }

  async clear(): Promise<void> {
    this.area.clear();
  }
}

const DB_NAME = "securelink-secure-storage";
const DB_VERSION = 1;
const STORE = "vault";
const KEY_RECORD = "__master_key__";

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/**
 * Web secure storage for SecureLink session material (identity + tokens).
 *
 * Uses Web Crypto AES-GCM with a non-extractable key in IndexedDB.
 * Ciphertext lives in IndexedDB — not plaintext localStorage.
 *
 * Note: browsers have no Keychain. Prefer HttpOnly cookies from your server
 * when possible; this is the strongest client-side option without cookies.
 * XSS can still abuse an open page session — keep CSP tight.
 */
export class SecureWebStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private cryptoKey: CryptoKey | null = null;

  constructor(private namespace = "securelink") {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(`${DB_NAME}:${this.namespace}`, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
    return this.dbPromise;
  }

  private async idbGet(key: string): Promise<string | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
    });
  }

  private async idbSet(key: string, value: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB set failed"));
    });
  }

  private async idbRemove(key: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB remove failed"));
    });
  }

  private async idbClear(): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
    });
  }

  private async getCryptoKey(): Promise<CryptoKey> {
    if (this.cryptoKey) return this.cryptoKey;
    if (!globalThis.crypto?.subtle) {
      throw new Error("Web Crypto is required for SecureWebStorage");
    }

    const existing = await this.idbGet(KEY_RECORD);
    if (existing) {
      const raw = base64ToBytes(existing);
      this.cryptoKey = await crypto.subtle.importKey(
        "raw",
        asBufferSource(raw),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
      return this.cryptoKey;
    }

    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    await this.idbSet(KEY_RECORD, bytesToBase64(raw));

    // Re-import as non-extractable for runtime use
    this.cryptoKey = await crypto.subtle.importKey(
      "raw",
      asBufferSource(raw),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    return this.cryptoKey;
  }

  private async encrypt(plain: string): Promise<string> {
    const key = await this.getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plain);
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
    );
    return `${bytesToBase64(iv)}.${bytesToBase64(cipher)}`;
  }

  private async decrypt(payload: string): Promise<string> {
    const [ivB64, cipherB64] = payload.split(".");
    if (!ivB64 || !cipherB64) throw new Error("corrupt secure storage payload");
    const key = await this.getCryptoKey();
    const iv = base64ToBytes(ivB64);
    const cipher = base64ToBytes(cipherB64);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      key,
      asBufferSource(cipher),
    );
    return new TextDecoder().decode(plain);
  }

  async get(key: string): Promise<string | null> {
    const sealed = await this.idbGet(key);
    if (!sealed) return null;
    try {
      return await this.decrypt(sealed);
    } catch {
      await this.idbRemove(key);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.idbSet(key, await this.encrypt(value));
  }

  async remove(key: string): Promise<void> {
    await this.idbRemove(key);
  }

  async clear(): Promise<void> {
    await this.idbClear();
    this.cryptoKey = null;
  }
}
