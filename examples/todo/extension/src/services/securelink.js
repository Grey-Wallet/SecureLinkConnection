import { createExtensionSecureLink } from "@securelink/extension";
import { API_URL } from "./publicApi.js";

let anonymousClient;

export async function loginAsGuest() {
  anonymousClient = await createExtensionSecureLink({
    baseUrl: API_URL,
    authMode: "anonymous",
    installationProofEnabled: true,
  });
  await anonymousClient.clearSession();
  await anonymousClient.initialize(true);
  const session = await anonymousClient.session.get();
  return {
    client: anonymousClient,
    userId: session.identity?.id ?? "guest",
  };
}

export function getAnonymousClient() {
  if (!anonymousClient) throw new Error("Guest session not started");
  return anonymousClient;
}
