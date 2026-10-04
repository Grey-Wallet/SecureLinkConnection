import { createReactNativeSecureLink } from "@securelink/react-native";
import { API_URL } from "./publicApi.js";

/** Guest — Keychain when installed; demo allows memory fallback */
export const anonymousClient = createReactNativeSecureLink({
  baseUrl: API_URL,
  authMode: "anonymous",
  nativePlatform: "ios",
  attestationEnabled: true,
  storagePrefix: "securelink-anon",
  allowInsecureMemoryStorage: true,
  allowInsecureDevAttestation: true,
});

export async function loginAsGuest() {
  await anonymousClient.clearSession();
  await anonymousClient.initialize(true);
  const session = await anonymousClient.session.get();
  return { client: anonymousClient, userId: session.identity?.id ?? "guest" };
}
