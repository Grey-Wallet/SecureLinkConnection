import { createWebSecureLink } from "@securelink/web";
import { API_URL } from "./publicApi.js";

const TOKEN_KEY = "securelink-demo-token";
let demoToken = localStorage.getItem(TOKEN_KEY) ?? "";

/** Signed-in client — SecureLink customAuth (your token, no anonymous identity) */
export const customAuthClient = createWebSecureLink({
  baseUrl: API_URL,
  authMode: "customAuth",
  storagePrefix: "securelink-custom",
  authorization: {
    async getAuthorization() {
      if (!demoToken) return null;
      return { authorization: `Bearer ${demoToken}`, scheme: "custom" };
    },
  },
});

export async function loginAsUser(username = "alex") {
  demoToken = `demo-${String(username).trim() || "alex"}`;
  localStorage.setItem(TOKEN_KEY, demoToken);
  await customAuthClient.initialize();
  return { client: customAuthClient, userId: `user_${demoToken.slice(5)}` };
}

export async function restoreUserSession() {
  if (!demoToken) return null;
  await customAuthClient.initialize();
  return { client: customAuthClient, userId: `user_${demoToken.slice(5)}` };
}

export function logoutUser() {
  demoToken = "";
  localStorage.removeItem(TOKEN_KEY);
}

export function hasStoredUser() {
  return Boolean(demoToken);
}
