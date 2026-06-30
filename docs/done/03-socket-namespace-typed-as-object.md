# `import * as socket from 'socket'` — namespace typed as the socket *object*, not the module

> **STATUS: FIXED in 0.6.200.** A namespace import (`import * as X`) is now always a module
> namespace, never an object-handle export — even when the module name doubles as an object
> type (`socket` is the only such name). It is marked `importSpecifier === '*'`; the
> typeChecker and completion both detect that and resolve MODULE members (functions →
> FUNCTION, constants → integer) instead of the socket object's methods. A real socket
> object handle (`let s = socket.create(...)`) still uses object methods (its symbol has no
> `'*'` specifier). Fixes: semanticAnalyzer `isObjectHandleExport` excludes namespace
> imports; typeChecker `isModuleNamespace` skips the object branch + resolves module
> constants; completion `getUnifiedObjectTypeCompletions` bails for a module namespace.
> Tests: `tests/test-socket-namespace-import.test.js` (29). Repro: `socket-namespace-demo.uc`.

**Severity: high.** When `socket` is imported as a namespace, the LSP types the namespace as the **socket connection object** instead of the **socket module**. As a result every module-level function (`create`, `sockaddr`, `connect`, `listen`, `nameinfo`, `addrinfo`, `poll`, …) and every module constant (`AF_INET`, `AF_INET6`, `SOCK_STREAM`, `SOCK_NONBLOCK`, `SOL_TCP`, `TCP_USER_TIMEOUT`, `POLLIN`, …) falsely errors `Method 'X' does not exist on socket`, and completion offers the wrong member set.

## Reproduction

Real corpus: `openwrt/.../unetmsg/unetmsgd-remote.uc`, `luci-app-dockerman/.../docker_rpc.uc`.

```ucode
import * as socket from "socket";

let sock = socket.create(socket.AF_INET6, socket.SOCK_STREAM | socket.SOCK_NONBLOCK);
//                ^^^^^^         ^^^^^^^^         ^^^^^^^^^^^   all "does not exist on socket"
let addr = socket.sockaddr({ ... });          // "Method 'sockaddr' does not exist on socket"
```

35+ occurrences. All of these are valid: verified `socket.create`, `socket.AF_INET6`, `socket.SOCK_STREAM`, `socket.sockaddr` all resolve in `/usr/local/bin/ucode`.

## Internal inconsistency

The three LSP subsystems disagree about what `socket` is:

| Feature | Behaviour |
|---|---|
| **Hover** on `socket` | correct — `(imported) socket: socket module` |
| **Diagnostics** (member access) | wrong — validates against the socket *object* methods |
| **Completion** after `socket.` | wrong — offers object methods (`connect, bind, listen, accept, send, recv, setopt, …`), **not** `create`/`sockaddr`/`AF_INET`/constants |

## Root cause

`socket` is the one name that is simultaneously a `KnownModule` and a `KnownObjectType` (`src/analysis/moduleTypes.ts`). The module *does* define a full `functions` map in `src/analysis/socketTypes.ts` (create/connect/listen/sockaddr/nameinfo/addrinfo/…), but the namespace-import resolver picks the object type for member validation and completion. (Per memory this is the "socket regression" that an earlier `&& !isKnownModule(moduleName)` guard was meant to prevent — it is live again for `import * as socket`.)
