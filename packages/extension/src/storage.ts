import type { StorageAdapter } from "@securelink/core";

type StorageArea = {
  get: (
    keys: string | string[] | null,
    callback?: (result: Record<string, string>) => void,
  ) => Promise<Record<string, string>> | void;
  set: (
    items: Record<string, string>,
    callback?: () => void,
  ) => Promise<void> | void;
  remove: (
    keys: string | string[],
    callback?: () => void,
  ) => Promise<void> | void;
  clear?: (callback?: () => void) => Promise<void> | void;
};

/**
 * Resolve WebExtensions storage for Chrome, Firefox, Edge, etc.
 * Prefers `browser.*` (Firefox / polyfill), then `chrome.*`.
 */
export function resolveExtensionStorageArea(
  preferSession = false,
): StorageArea | undefined {
  const g = globalThis as unknown as {
    browser?: { storage?: { session?: StorageArea; local?: StorageArea } };
    chrome?: { storage?: { session?: StorageArea; local?: StorageArea } };
  };

  const browserApi = g.browser?.storage;
  const chromeApi = g.chrome?.storage;

  if (preferSession) {
    return (
      browserApi?.session ??
      chromeApi?.session ??
      browserApi?.local ??
      chromeApi?.local
    );
  }
  return browserApi?.local ?? chromeApi?.local ?? browserApi?.session ?? chromeApi?.session;
}

/**
 * Extension session storage (Chrome / Firefox / Edge / Chromium).
 * Uses WebExtensions storage — never page localStorage.
 */
export class ExtensionStorage implements StorageAdapter {
  private memory = new Map<string, string>();
  private area: StorageArea | undefined;
  private allowMemoryFallback: boolean;

  constructor(options?: {
    preferSession?: boolean;
    area?: StorageArea;
    /** LOCAL DEMOS / TESTS ONLY */
    allowMemoryFallback?: boolean;
  }) {
    this.allowMemoryFallback = options?.allowMemoryFallback === true;
    this.area =
      options?.area ?? resolveExtensionStorageArea(options?.preferSession ?? false);
    if (!this.area && !this.allowMemoryFallback) {
      throw new Error(
        "[@securelink/extension] browser.storage / chrome.storage required. " +
          "Add the storage permission. Set allowMemoryFallback only for tests.",
      );
    }
  }

  private async areaGet(key: string): Promise<string | null> {
    const area = this.area;
    if (!area) return this.memory.get(key) ?? null;

    try {
      const maybe = area.get([key]);
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        const result = await (maybe as Promise<Record<string, string>>);
        return result[key] ?? null;
      }
    } catch {
      // callback style
    }

    return new Promise((resolve) => {
      area.get([key], (result) => resolve(result?.[key] ?? null));
    });
  }

  private async areaSet(key: string, value: string): Promise<void> {
    const area = this.area;
    if (!area) {
      this.memory.set(key, value);
      return;
    }

    try {
      const maybe = area.set({ [key]: value });
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        await maybe;
        return;
      }
    } catch {
      // callback
    }

    await new Promise<void>((resolve) => {
      area.set({ [key]: value }, () => resolve());
    });
  }

  private async areaRemove(key: string): Promise<void> {
    const area = this.area;
    if (!area) {
      this.memory.delete(key);
      return;
    }

    try {
      const maybe = area.remove(key);
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        await maybe;
        return;
      }
    } catch {
      // callback
    }

    await new Promise<void>((resolve) => {
      area.remove(key, () => resolve());
    });
  }

  async get(key: string): Promise<string | null> {
    return this.areaGet(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.areaSet(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.areaRemove(key);
  }

  async clear(): Promise<void> {
    const area = this.area;
    this.memory.clear();
    if (!area?.clear) return;

    try {
      const maybe = area.clear();
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        await maybe;
        return;
      }
    } catch {
      // callback
    }

    await new Promise<void>((resolve) => {
      area.clear!(() => resolve());
    });
  }
}
