# @securelink/web

SecureLink client SDK for **browser / SPA** apps.

Supports `anonymous` and `customAuth` modes, with secure session storage (AES-GCM + IndexedDB) and optional HttpOnly cookie delivery.

## Install

```bash
npm install @securelink/web
```

## Quick start

```ts
import { createWebSecureLink } from "@securelink/web";

const client = createWebSecureLink({
  baseUrl: "https://api.example.com",
  authMode: "anonymous",
});

await client.initialize();
const res = await client.request({ method: "GET", path: "/api/items" });
```

Pair with [`@securelink/server`](https://www.npmjs.com/package/@securelink/server) on your backend.

## Links

- **Docs:** [SecureLink Documentation](https://secure-link-connection-docs.vercel.app/)
- **Web guide:** [Getting started — Web](https://secure-link-connection-docs.vercel.app/docs/getting-started/web)
- **Examples:** [Todo sample apps](https://github.com/Grey-Wallet/SecureLinkConnection/tree/main/examples/todo)
- **Source:** [GitHub](https://github.com/Grey-Wallet/SecureLinkConnection)

## License

MIT
