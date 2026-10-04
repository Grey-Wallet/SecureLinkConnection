# SecureLink Todo Example

Small **JavaScript** sample with a real login flow:

1. **Login screen** — Continue as guest **or** Sign in  
2. **App** — one todo list owned by that user (anonymous id **or** real user id)  
3. **Log out** — back to login  

Public stats stay visible (no SecureLink).

```text
examples/todo/
├── server/
├── web/          main demo
├── mobile/
└── extension/
```

```text
services/
  publicApi.js      # public fetch
  securelink.js     # guest (anonymous) login
  account.js        # user (customAuth) login
  todos.js          # todos for whoever is logged in
```

## Run

```bash
pnpm todo:server
pnpm todo:web
```

Demo sign-in token: `Bearer demo-<username>`.
