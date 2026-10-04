# SecureLink SDK

Public SDK monorepo: packages, examples, and tests.

**GitHub:** public repo (everyone can view, only owners can edit)  
**Sibling project:** docs site lives in a **separate private** repo → deployed on Vercel (public website).

## Packages

| Package | Description |
|---------|-------------|
| `@securelink/protocol` | Protocol types & errors |
| `@securelink/crypto` | Signing / hashing |
| `@securelink/core` | Shared client core |
| `@securelink/web` | Browser client |
| `@securelink/react-native` | Mobile client |
| `@securelink/extension` | Extension client |
| `@securelink/server` | Node server SDK |

## After you clone (or deleted your old folder)

Need: Node 20+, pnpm 11 (`npm i -g pnpm`).

```bash
git clone https://github.com/Grey-Wallet/SecureLinkConnection.git
cd SecureLinkConnection
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

### Todo example (end-to-end)

```bash
# Terminal 1
pnpm todo:server          # http://127.0.0.1:8787

# Terminal 2
pnpm todo:web             # http://127.0.0.1:5173
```

Also: `pnpm todo:extension` · `pnpm todo:mobile`  
Details: [examples/todo/README.md](examples/todo/README.md)

### After you change code

| Changed | Run |
|---------|-----|
| `packages/*` | `pnpm build && pnpm test` |
| Todo example | `pnpm todo:server` + `pnpm todo:web` |

Then commit & push this repo.

## Docs site

Not in this repo. Clone the **private** docs repo separately (e.g. `SecureLinkConnection-docs`), then:

```bash
cd SecureLinkConnection-docs
pnpm install
pnpm dev                  # http://127.0.0.1:3000
```

## License

MIT
