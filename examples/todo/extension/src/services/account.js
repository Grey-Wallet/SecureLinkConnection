import { createExtensionSecureLink } from "@securelink/extension";
import { API_URL } from "./publicApi.js";

const TOKEN_KEY = "securelink-demo-token";
let demoToken = "";
let customAuthClient;

async function readStoredToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return stored[TOKEN_KEY] ?? "";
}

async function ensureClient() {
  if (customAuthClient) return customAuthClient;
  customAuthClient = await createExtensionSecureLink({
    baseUrl: API_URL,
    authMode: "customAuth",
    installationProofEnabled: true,
    authorization: {
      async getAuthorization() {
        if (!demoToken) return null;
        return { authorization: `Bearer ${demoToken}`, scheme: "custom" };
      },
    },
  });
  return customAuthClient;
}

export async function loginAsUser(username = "alex") {
  demoToken = `demo-${String(username).trim() || "alex"}`;
  await chrome.storage.local.set({ [TOKEN_KEY]: demoToken });
  const client = await ensureClient();
  await client.initialize();
  return { client, userId: `user_${demoToken.slice(5)}` };
}

export async function restoreUserSession() {
  demoToken = await readStoredToken();
  if (!demoToken) return null;
  const client = await ensureClient();
  await client.initialize();
  return { client, userId: `user_${demoToken.slice(5)}` };
}

export async function logoutUser() {
  demoToken = "";
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function hasStoredUser() {
  return Boolean(await readStoredToken());
}
