# @securelink/server

SecureLink **Node.js** server SDK — verify clients, build a `SecurityContext`, and rate-limit protected APIs.

## Install

```bash
npm install @securelink/server
```

## Quick start

```ts
import { createSecureLinkServer } from "@securelink/server";

const securelink = createSecureLinkServer({
  authMode: "both",
  tokenHashSecret: process.env.SECURELINK_TOKEN_SECRET!,
  authorizationValidator: myJwtValidator, // required for customAuth
});

// bootstrap / refresh / verify — see docs
const ctx = await securelink.verify({
  headers: req.headers,
  body: req.body,
  ip: req.ip,
  method: req.method,
  path: req.path,
});
```

## Links

- **Docs:** [SecureLink Documentation](https://secure-link-connection-docs.vercel.app/)
- **Server guide:** [Getting started — Server](https://secure-link-connection-docs.vercel.app/docs/getting-started/server)
- **What you provide:** [Checklist](https://secure-link-connection-docs.vercel.app/docs/concepts/what-you-provide)
- **Examples:** [Todo sample apps](https://github.com/Grey-Wallet/SecureLinkConnection/tree/main/examples/todo)
- **Source:** [GitHub](https://github.com/Grey-Wallet/SecureLinkConnection)

## License

MIT
