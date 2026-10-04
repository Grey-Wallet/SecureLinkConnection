# @securelink/extension

SecureLink client SDK for **browser extensions** (Chrome, Firefox, Edge).

Uses WebExtensions storage (`browser.storage` / `chrome.storage`) and installation request proofs.

## Install

```bash
npm install @securelink/extension
```

## Quick start

```ts
import { createExtensionSecureLink } from "@securelink/extension";

const client = await createExtensionSecureLink({
  baseUrl: "https://api.example.com",
  authMode: "anonymous",
  installationProofEnabled: true,
});

await client.initialize();
```

Manifest needs the `storage` permission.

## Links

- **Docs:** [SecureLink Documentation](https://secure-link-connection-docs.vercel.app/)
- **Extension guide:** [Getting started — Extension](https://secure-link-connection-docs.vercel.app/docs/getting-started/extension)
- **Examples:** [Todo sample apps](https://github.com/Grey-Wallet/SecureLinkConnection/tree/main/examples/todo)
- **Source:** [GitHub](https://github.com/Grey-Wallet/SecureLinkConnection)

## License

MIT
