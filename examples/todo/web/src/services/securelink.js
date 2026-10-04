import { createWebSecureLink } from "@securelink/web";
import { API_URL } from "./publicApi.js";

/** Guest client — SecureLink anonymous */
export const anonymousClient = createWebSecureLink({
  baseUrl: API_URL,
  authMode: "anonymous",
  persistent: true,
  storagePrefix: "securelink-anon",
});

/** Always get a fresh guest session from the current server */
export async function loginAsGuest() {
  await anonymousClient.clearSession();
  await anonymousClient.initialize(true);
  return anonymousClient;
}
