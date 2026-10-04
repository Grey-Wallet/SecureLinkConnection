import {
  SecureLinkClient,
  createSecureLinkClient,
  ProtocolError,
  type AttestationProvider,
  type AuthorizationProvider,
  type SecureLinkClientConfig,
  type StorageAdapter,
} from "@securelink/core";
import { secureRandom } from "@securelink/crypto";
import type { ProofMetadata } from "@securelink/protocol";
import {
  KeychainStorage,
  SecureMemoryStorage,
  SecureStoreStorage,
  createKeychainStorage,
  createSecureStoreStorage,
  resolveNativeSecureStorage,
} from "./storage.js";

export type NativePlatform = "ios" | "android";

export interface NativeAttestationOptions {
  platform: NativePlatform;
  /**
   * Required in production when attestation is enabled.
   * Wire Apple App Attest / Play Integrity native modules here.
   */
  getAttestationToken?: (challenge: string) => Promise<string>;
  /**
   * LOCAL DEMOS ONLY — allows stub proofs when getAttestationToken is missing.
   */
  allowInsecureDevAttestation?: boolean;
}

/**
 * App Attest / Play Integrity provider.
 * Enabled in BOTH anonymous and customAuth when attestation.enabled is true.
 */
export class NativeAttestationProvider implements AttestationProvider {
  constructor(private options: NativeAttestationOptions) {}

  async getProof(challenge?: string): Promise<ProofMetadata> {
    const c = challenge ?? secureRandom(16);
    if (this.options.getAttestationToken) {
      const proof = await this.options.getAttestationToken(c);
      return {
        type: this.options.platform === "ios" ? "app-attest" : "play-integrity",
        proof,
        challenge: c,
      };
    }

    if (this.options.allowInsecureDevAttestation) {
      return {
        type: this.options.platform === "ios" ? "app-attest" : "play-integrity",
        proof: `dev-${this.options.platform}-attest-${c}`,
        challenge: c,
      };
    }

    throw new ProtocolError(
      "PROOF_REQUIRED",
      "getAttestationToken is required for production native attestation " +
        "(or set allowInsecureDevAttestation for local demos only)",
      403,
    );
  }
}

export type ReactNativeSecureLinkOptions = Omit<
  SecureLinkClientConfig,
  "platform" | "attestation"
> & {
  nativePlatform: NativePlatform;
  /** Default true — proofs stay on for customAuth too */
  attestationEnabled?: boolean;
  getAttestationToken?: (challenge: string) => Promise<string>;
  /**
   * Secure session storage (Keychain / Keystore / SecureStore).
   * Required in production unless react-native-keychain is installed.
   */
  secureStorage?: StorageAdapter;
  /** LOCAL DEMOS ONLY — memory storage fallback */
  allowInsecureMemoryStorage?: boolean;
  /** LOCAL DEMOS ONLY — stub App Attest / Play Integrity proofs */
  allowInsecureDevAttestation?: boolean;
};

/**
 * Create SecureLink for React Native (production-oriented).
 *
 * - Session tokens → Keychain/Keystore
 * - Attestation → real App Attest / Play Integrity via getAttestationToken
 * - customAuth skips anonymous identity but keeps attestation when enabled
 */
export function createReactNativeSecureLink(
  options: ReactNativeSecureLinkOptions,
): SecureLinkClient {
  const attestationEnabled = options.attestationEnabled ?? true;
  const provider = new NativeAttestationProvider({
    platform: options.nativePlatform,
    getAttestationToken: options.getAttestationToken,
    allowInsecureDevAttestation: options.allowInsecureDevAttestation,
  });

  const storage = resolveNativeSecureStorage({
    secureStorage:
      options.secureStorage ??
      (typeof options.storage === "object" ? options.storage : undefined),
    allowInsecureMemoryStorage: options.allowInsecureMemoryStorage,
    service: "securelink",
  });

  return createSecureLinkClient({
    ...options,
    platform: "react-native",
    storage,
    attestation: {
      enabled: attestationEnabled,
      provider,
    },
  });
}

export type { AuthorizationProvider, SecureLinkClient, AttestationProvider, StorageAdapter };
export {
  MemoryStorage,
  ProtocolError,
  type AuthMode,
  type SecureLinkResponse,
} from "@securelink/core";
export {
  KeychainStorage,
  SecureMemoryStorage,
  SecureStoreStorage,
  createKeychainStorage,
  createSecureStoreStorage,
  resolveNativeSecureStorage,
};
