# @securelink/react-native

SecureLink client SDK for **React Native** (iOS & Android).

Uses Keychain / Keystore for session material and App Attest / Play Integrity when attestation is enabled.

## Install

```bash
npm install @securelink/react-native react-native-keychain
```

## Quick start

```ts
import { createReactNativeSecureLink } from "@securelink/react-native";

const client = createReactNativeSecureLink({
  baseUrl: "https://api.example.com",
  authMode: "anonymous",
  nativePlatform: "ios",
  getAttestationToken: (challenge) => nativeAppAttest(challenge),
});

await client.initialize();
```

## Links

- **Docs:** [SecureLink Documentation](https://secure-link-connection-docs.vercel.app/)
- **RN guide:** [Getting started — React Native](https://secure-link-connection-docs.vercel.app/docs/getting-started/react-native)
- **Examples:** [Todo sample apps](https://github.com/Grey-Wallet/SecureLinkConnection/tree/main/examples/todo)
- **Source:** [GitHub](https://github.com/Grey-Wallet/SecureLinkConnection)

## License

MIT
