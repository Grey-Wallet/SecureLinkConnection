import { createReactNativeSecureLink } from "@securelink/react-native";
import { API_URL } from "./publicApi.js";

let demoToken = "";

/** Signed-in — demo flags only for the sample app */
export const customAuthClient = createReactNativeSecureLink({
  baseUrl: API_URL,
  authMode: "customAuth",
  nativePlatform: "ios",
  attestationEnabled: true,
  storagePrefix: "securelink-custom",
  allowInsecureMemoryStorage: true,
  allowInsecureDevAttestation: true,
  authorization: {
    async getAuthorization() {
      if (!demoToken) return null;
      return { authorization: `Bearer ${demoToken}`, scheme: "custom" };
    },
  },
});

export async function loginAsUser(username = "alex") {
  demoToken = `demo-${String(username).trim() || "alex"}`;
  await customAuthClient.initialize();
  return { client: customAuthClient, userId: `user_${demoToken.slice(5)}` };
}

export function logoutUser() {
  demoToken = "";
}

export function isLoggedIn() {
  return Boolean(demoToken);
}
