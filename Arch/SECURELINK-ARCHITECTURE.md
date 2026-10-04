# SecureLink SDK

## 1. Purpose

SecureLink is a client-to-server security and communication SDK.

Its purpose is to make it easier for developers to securely connect:

- Web applications
- React Native applications
- Browser extensions
- Other supported client environments

to their own backend.

SecureLink also provides a Server SDK that runs inside the developer's backend.

SecureLink does NOT provide or control the developer's:

- Business APIs
- Database
- Business logic
- User database
- User registration system
- User login UI
- User authentication provider
- Application-specific authorization rules
- Application-specific rate limits

SecureLink provides the security/communication layer between the client and backend.

---

# 2. High-Level Architecture

```text
                         DEVELOPER APPLICATION
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
               CLIENT SIDE                 SERVER SIDE
                    │                           │
        ┌───────────┼───────────┐               │
        │           │           │               │
       Web     React Native  Extension         Node
        │           │           │               │
        └───────────┼───────────┘               │
                    │                           │
                    ▼                           ▼
              SECURELINK CLIENT          SECURELINK SERVER
                    │                           │
                    └───────────┬───────────────┘
                                │
                         SecureLink Protocol
                                │
                                ▼
                         DEVELOPER BACKEND
                                │
                                ▼
                    DEVELOPER APIs / SERVICES
```

# 3. Repository Structure

Use a monorepo.

```text
securelink/
│
├── apps/
│   ├── docs/
│   └── examples/
│       ├── web/
│       ├── react-native/
│       ├── extension/
│       └── node-server/
│
├── packages/
│   ├── core/
│   ├── protocol/
│   ├── crypto/
│   ├── web/
│   ├── react-native/
│   ├── extension/
│   └── server/
│
├── docs/
│   ├── architecture/
│   ├── security/
│   ├── protocol/
│   ├── client/
│   ├── server/
│   └── decisions/
│
├── tests/
│   ├── integration/
│   ├── security/
│   └── compatibility/
│
├── tooling/
│   ├── build/
│   ├── release/
│   └── test/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
└── SECURITY.md
```

# 4. Package Responsibilities

## `@securelink/core`

The shared foundation.

Contains:

```text
Request model
Response model
Authentication abstractions
Authorization abstractions
Identity abstractions
Token abstractions
Storage abstractions
Request lifecycle
Error model
Configuration model
SDK lifecycle
Common utilities
```

It must remain environment-agnostic.

It must NOT directly depend on:

```text
Browser APIs
React Native APIs
Node.js APIs
Chrome APIs
Safari APIs
Apple APIs
Google APIs
```

---

## `@securelink/protocol`

Defines the SecureLink communication protocol.

Responsibilities:

```text
Client ↔ Server message formats
Request metadata
Authorization metadata
Identity metadata
Proof metadata
Challenge / response concepts
Protocol versioning
Protocol errors
Protocol capabilities
Compatibility rules
```

Defines what is communicated, not how a platform implements it.

---

## `@securelink/crypto`

Shared cryptographic primitives and abstractions.

Responsibilities:

```text
Key generation abstractions
Signing
Signature verification
Challenge generation
Request proof
Hashing
Encoding
Cryptographic utilities
Secure random generation
Key representation
```

Platform-specific secure key storage does not belong here.

---

## `@securelink/web`

Web client SDK.

Target:

```text
Web applications
Browser applications
SPA
SSR-compatible environments where supported
```

Responsibilities:

```text
Browser HTTP transport
Browser storage adapters
Browser credential handling
Web anonymous identity
Web authorization integration
Browser security integration
Web request lifecycle
```

---

## `@securelink/react-native`

React Native client SDK.

Target:

```text
iOS
Android
React Native
```

Responsibilities:

```text
React Native HTTP transport
Secure storage integration
Native key storage integration
Native app identity
Native attestation integration
iOS-specific security integration
Android-specific security integration
React Native lifecycle
```

Platform-specific functionality should be abstracted.

Conceptually:

```text
React Native
     │
     ├── iOS adapter
     └── Android adapter
```

---

## `@securelink/extension`

Browser extension support.

Target:

```text
Chrome
Edge
Firefox
Safari
Other compatible extension environments
```

This should initially be a thin package.

It should reuse:

```text
@securelink/core
@securelink/web
@securelink/protocol
@securelink/crypto
```

Responsibilities:

```text
Extension-specific storage
Extension installation identity
Extension lifecycle
Extension-specific permissions
Extension request proof
Extension runtime integration
```

Do NOT duplicate the Web SDK.

---

## `@securelink/server`

Server-side SDK.

Target initially:

```text
Node.js
TypeScript
JavaScript
```

Responsibilities:

```text
Client request verification
SecureLink protocol validation
Authorization verification
Anonymous identity verification
Request proof verification
Challenge verification
Token verification
Server-side credential handling
Client identity resolution
Security context creation
Secure server communication
Backend integration
```

The Server SDK runs inside the developer's backend.

```text
Client Application
       │
       ▼
SecureLink Client SDK
       │
       ▼
Developer Backend
       │
       ▼
SecureLink Server SDK
       │
       ▼
Developer Business Logic / APIs
```

# 5. Client SDK Layers

All client SDKs should follow a common conceptual structure.

```text
Application
    │
    ▼
SecureLink Client API
    │
    ▼
Client Core
    │
    ├── Identity
    ├── Authorization
    ├── Request Pipeline
    ├── Credential Management
    ├── Security Context
    └── Transport
         │
         ▼
      Network
```

Platform-specific implementations are injected below the core layer.

# 6. Authentication Modes

SecureLink supports two major modes.

## Anonymous Mode

SecureLink manages the anonymous identity/authorization lifecycle.

```text
Application
    │
    ▼
SecureLink
    │
    ▼
Anonymous Identity
    │
    ▼
Authorization
    │
    ▼
Developer Backend
```

Persistence must be configurable.

The developer may choose:

```text
Memory only
Persistent storage
Custom storage
Platform secure storage
```

---

## External Authentication Mode

The developer already has their own authentication system.

SecureLink must NOT replace it.

```text
Application
    │
    ▼
Developer Authentication
    │
    ▼
Developer Authorization
    │
    ▼
SecureLink
    │
    ▼
Developer Backend
```

SecureLink should expose an abstraction allowing the developer to provide authorization information.

SecureLink must not assume:

```text
JWT
OAuth
Cookie
Session
Password
Passkey
API Key
Magic Link
```

The authentication mechanism belongs to the developer.

# 7. Identity Layer

Create a generic identity abstraction.

Identity may represent:

```text
Anonymous identity
Authenticated user
Device
Application installation
Browser installation
Extension installation
```

Conceptually:

```text
Identity
   │
   ├── Anonymous
   ├── User
   ├── Device
   └── Installation
```

# 8. Credential Layer

Separate credentials from identity.

The SDK should support concepts such as:

```text
Access credential
Refresh credential
Session credential
Authorization data
Request proof
Installation proof
```

Do not hard-code one credential mechanism into the entire SDK architecture.

# 9. Storage Layer

Storage must be an abstraction.

```text
Storage
   │
   ├── Memory
   ├── Browser
   ├── React Native Secure Storage
   ├── Extension Storage
   └── Developer Custom Storage
```

The core SDK only understands the storage interface.

Platform packages provide implementations.

# 10. Request Pipeline

Every request should pass through a common lifecycle.

```text
Application Request
        │
        ▼
Request Creation
        │
        ▼
Resolve Identity
        │
        ▼
Resolve Authorization
        │
        ▼
Prepare Security Data
        │
        ▼
Create SecureLink Request
        │
        ▼
Transport
        │
        ▼
Developer Backend
        │
        ▼
Server SDK
        │
        ▼
Verification
        │
        ▼
Developer API
        │
        ▼
Response
```

# 11. Server SDK Pipeline

```text
Incoming Request
       │
       ▼
Protocol Validation
       │
       ▼
SecureLink Validation
       │
       ▼
Identity Resolution
       │
       ▼
Authorization Validation
       │
       ▼
Request Proof Validation
       │
       ▼
Security Context
       │
       ▼
Developer Backend Logic
       │
       ▼
Response
```

The Server SDK exposes the verified security context to the developer.

# 12. Security Context

The Server SDK should produce a normalized security context.

Conceptually it may contain:

```text
Identity
Identity Type
Authorization State
Client Platform
Application Installation
Request Metadata
Proof Verification Result
Protocol Version
Security Metadata
```

Do not mix business-specific information into this context.

# 13. Platform Abstraction Layer

Avoid platform-specific logic inside `core`.

Use adapters.

```text
                SecureLink Core
                      │
          ┌───────────┼───────────┐
          │           │           │
        Web       React Native   Server
          │           │           │
      Browser      Native       Node
      Adapter      Adapter     Adapter
```

# 14. Web vs Extension

Do not duplicate the implementation.

Preferred:

```text
@securelink/web
       │
       ├── Web Runtime
       │
       └── Extension Runtime
               │
               ▼
       Extension Adapter
```

Only create substantial extension-specific code where browser extension APIs require it.

# 15. React Native Separation

React Native remains a separate client package because its environment differs substantially from browsers.

```text
Web
 │
 └── Browser APIs

React Native
 │
 ├── iOS APIs
 ├── Android APIs
 └── Native secure storage
```

Shared logic remains in `core`.

# 16. Server Environment Separation

Server code must never be bundled into browser/mobile/extension packages.

```text
CLIENT PACKAGES
    │
    ├── web
    ├── react-native
    └── extension

SERVER PACKAGE
    │
    └── server
```

No server secrets should ever be included in client packages.

# 17. Public API Organization

Each SDK should expose a small public API.

Avoid exposing internal implementation details.

Conceptually:

```text
Public API
    │
    ├── Client
    ├── Configuration
    ├── Authentication configuration
    ├── Storage interfaces
    ├── Authorization interfaces
    ├── Security interfaces
    └── Errors
```

# 18. Documentation Structure

```text
docs/
│
├── getting-started/
│   ├── web.md
│   ├── react-native.md
│   ├── extension.md
│   └── server.md
│
├── concepts/
│   ├── architecture.md
│   ├── anonymous-mode.md
│   ├── external-auth.md
│   ├── identity.md
│   ├── authorization.md
│   └── storage.md
│
├── security/
│   ├── security-model.md
│   ├── threat-model.md
│   ├── client-security.md
│   ├── server-security.md
│   └── platform-security.md
│
├── protocol/
│   ├── overview.md
│   ├── requests.md
│   ├── identity.md
│   ├── authorization.md
│   └── versioning.md
│
└── architecture/
    ├── overview.md
    ├── packages.md
    └── decisions.md
```

# 19. Testing Structure

```text
tests/
│
├── unit/
│   ├── core/
│   ├── protocol/
│   └── crypto/
│
├── integration/
│   ├── web/
│   ├── react-native/
│   ├── extension/
│   └── server/
│
├── security/
│   ├── authentication/
│   ├── authorization/
│   ├── identity/
│   ├── replay/
│   ├── request-proof/
│   └── credential-handling/
│
└── compatibility/
    ├── browsers/
    ├── mobile/
    └── extensions/
```

# 20. Example Applications

```text
apps/examples/

├── web-example
├── react-native-example
├── extension-example
└── node-server-example
```

# 21. Security Documentation

`SECURITY.md` should document:

```text
Security model
Threat model
What SecureLink protects
What SecureLink does NOT protect
Client-side limitations
Browser limitations
Extension limitations
Mobile security assumptions
Server responsibilities
Credential handling
Key handling
Replay protection
Request verification
Reporting vulnerabilities
```

Never claim that a client SDK can make a public client secret truly secret.

# 22. Versioning

The SecureLink protocol should have an explicit version.

```text
Protocol Version
      │
      ├── Client SDK
      └── Server SDK
```

Client and server SDKs must have compatibility rules.

# 23. Package Dependency Direction

Keep dependencies flowing inward.

```text
                 protocol
                    ▲
                    │
                  core
               ▲    ▲    ▲
               │    │    │
             web   RN  server
               ▲
               │
           extension
```

Avoid:

```text
core → web
core → react-native
core → extension
core → server
```

The core must remain independent.

# 24. Final Package Tree

```text
securelink/
│
├── apps/
│   ├── docs/
│   └── examples/
│       ├── web/
│       ├── react-native/
│       ├── extension/
│       └── server/
│
├── packages/
│   ├── core/
│   ├── protocol/
│   ├── crypto/
│   ├── web/
│   ├── react-native/
│   ├── extension/
│   └── server/
│
├── docs/
│   ├── architecture/
│   ├── concepts/
│   ├── security/
│   ├── protocol/
│   └── getting-started/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── compatibility/
│
├── tooling/
│   ├── build/
│   ├── test/
│   └── release/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
└── SECURITY.md
```

# 25. Core Principle

SecureLink is a security and communication infrastructure layer, not an application framework.

```text
Developer owns:

    Users
    Authentication
    Business Logic
    APIs
    Database
    Rate Limits
    Application Rules


SecureLink owns:

    Client ↔ Server protocol
    Client SDK
    Server SDK
    Anonymous identity infrastructure
    Authorization integration
    Request security
    Identity/proof handling
    Credential lifecycle abstractions
    Platform security adapters
    Secure communication layer
```

The implementation details should be decided after this architecture is approved.
