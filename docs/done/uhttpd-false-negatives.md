# ucode-lsp × uhttpd handlers — blind spots, false positives/negatives, and a fix plan

> ✅ **RESOLVED (filed 2026-07-04).** All phases **A–E shipped (0.7.53–0.7.57)** — see the Status
> section below. Handler support is end-to-end in both the server and the CLI checker: detection,
> UC8011/UC8012/UC8013 (+ quick-fixes), and a typed, handler-gated `uhttpd` ambient. FN-3 dropped
> as a false premise.

A detailed, empirically-verified report for the `ucode-lsp` maintainer. Everything
below was reproduced in a real OpenWrt **24.10.7 x86-64 Docker container** running the
actual `uhttpd` + `uhttpd-mod-ucode` + `ucode-mod-{uci,ubus,fs,digest}` stack, and
cross-checked against uhttpd's `ucode.c`. Tool versions: `ucode-lsp v0.7.15`,
`uhttpd-mod-ucode 2025.07.06`.

---

## Re-triage against 0.7.53 (2026-07-03)

The report predates most template work. Re-running each case on **0.7.53** (canonical
handler + FN-1/2/4), the picture has changed a lot:

**False positives — largely RESOLVED.** Template mode `{% %}` shipped in **0.7.0**
(docs/ucode-template-mode-support.md), so the canonical handler no longer produces
UC6001 (template opener), UC3007 (import-not-top-level), or UC1002 (`handle` undefined
via a discarded import). The one surviving FP — **UC1006 on `global.handle_request`**
("declared but never used") — is fixed in **0.7.53**: a host entry-point callback
registered as `global.<name> = fn` is invoked by the host, not local dead code
(`HOST_ENTRY_POINT_CALLBACKS` in hostGlobals.ts; the suppression is targeted to that
binding shape, so a local `let handle_request` or an unrelated global still flags).
Residual: UC7003 (a low-severity "add JSDoc annotations" *suggestion* on the handler
fn) — not a correctness FP; out of scope.

**False negatives — still open.** FN-1 (not a template), FN-2 (local/export/return
`handle_request` instead of `global.`), FN-4 (`loadfile`/`include` aborting the handler
VM), FN-5 (typed, handler-gated `uhttpd` ambient). `uhttpd` is already registered as a
host-global (hostGlobals.ts, so `uhttpd.send(...)` doesn't UC1001), but it is seeded for
EVERY file (untyped) — not gated to handler context. FN-4's `loadfile()` already draws a
generic UC8001 (throwing call), but not the handler-specific "uncatchable VM abort → use
static import" message.

### Two report claims re-verified against ucode source + binary (2026-07-04)

The original report was written by an agent **without ucode-lsp/ucode source access**, so
its runtime claims were re-checked here:

- **FN-2 — CONFIRMED (real).** A top-level `function handle_request(){}` is a compiler
  LOCAL, not a property of the global scope object. uhttpd's entry lookup is
  `ucv_object_get(uc_vm_scope_get(vm), "handle_request")` — a lookup on the scope
  *object* — so only `global.handle_request = fn` is visible to it. Verified:
  `ucode -e 'function handle_request(){} print(type(global.handle_request))'` → null,
  while `... print(type(handle_request))` → function, and
  `global.handle_request = function(){}` → `type(global.handle_request)` = function.
- **FN-3 — FALSE (dropped).** The report claims `global` is null in a plain script so
  `global.X` throws. It does not: `uc_vm_alloc_global_scope` (vm.c:154) binds `global`
  as a self-referential property of the global scope at EVERY VM startup
  (`ucv_object_add(scope, "global", ucv_get(scope))`). Verified: `ucode -e 'global.x=1;
  print(global.x)'` → 1 (exit 0), incl. under `'use strict'` and file execution. `global`
  is always a valid object; modeling it as "null in scripts" would ADD a false positive.
  The existing global-scope suite (UC8001–8007) already handles `global.X` correctly.

### Authoritative `uhttpd` contract (pulled from `uhttpd/ucode.c`, master, 2026-07-04)

Extracted from the real source (not the report's summary). Entry point: uhttpd does
`ucv_object_get(uc_vm_scope_get(vm), "handle_request")`, requires `ucv_is_callable`, and
invokes `uc_vm_invoke(vm, "handle_request", 1, req)` — **one** argument.

The `uhttpd` ambient object (`ucode.c:240-247`) has exactly these members:

| Member | Kind | Signature (from the C impl) |
|---|---|---|
| `send` | method | `send(...values): integer` — stringifies + writes args to stdout, returns bytes written (`uh_ucode_send` → `ucv_int64_new(len)`) |
| `sendc` | method | alias of `send` (`ucv_get(ucv_object_get(v, "send"))`) — same signature |
| `recv` | method | `recv(length?: integer): string \| null` — reads ≤ length bytes (default BUFSIZ) from stdin; raises if arg present and non-integer (`uh_ucode_recv` → stringbuf) |
| `urldecode` | method | `urldecode(s: string): string \| null` (`uh_ucode_strconvert`) |
| `urlencode` | method | `urlencode(s: string): string \| null` (`uh_ucode_strconvert`) |
| `docroot` | **string property** | `ucv_string_new(conf.docroot)` — NOT callable (the report/summary listed it as a method; it is a string) |

The `req` argument to `handle_request(req)` (`ucode.c:340-367`): `PATH_INFO` (string),
CGI process vars (dynamic — `REQUEST_METHOD`, `QUERY_STRING`, `REMOTE_ADDR`, … string
values), `HTTP_VERSION` (double), `headers` (object: header-name → string). `vm->output`
is `/dev/null` during module init, then `stdout`; a per-request exception routes through
`uh_ucode_exception` (HTTP 500). Phase E types the ambient from this table.

**Phased plan for the remainder** (each phase is independently shippable). **Detection =
in-file heuristic only** (option-2 "read uhttpd config" dropped: the config lives in the
DEPLOY layout — `/etc/config/*` names a deployed handler path — and mapping it back to a
source file across the dev≠deploy `files/…` mirror is brittle; a package DOES ship the
config in-tree, so this stays a possible *future* signal. Option-3 project-setting dropped.)

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| A | UC1006 exemption for `global.handle_request` entry point | — | ✅ 0.7.53 |
| B | **Handler-file detection** — the linchpin. In-file signal: template mode (`{%`) AND `global.handle_request` assigned. Exposes `result.isUhttpdHandler`. Strict = a *correct/working* handler; gates C and E. | — | ✅ 0.7.54 |
| C | FN-4 (**UC8011**) — `loadfile`/`loadfile()()` / `include` in a handler → **error** (always, not strict-gated) "aborts the request VM uncatchably; use static import" (loadstring/import safe). Error, not warning: the abort is uncatchable, silent (empty response, no log), unrecoverable, strict-independent, and has no valid use in a handler — unlike UC8001 (a catchable throw). Suppresses UC8001's wrong "guard with try/catch" advice for loadfile in handler context. Whole-file (top-level + inside handle_request both abort); only the real builtins, not a shadowed name. | B | ✅ 0.7.54 (severity→error 0.7.57) |
| D | FN-1 (**UC8012**) — a file that assigns `global.handle_request` but is NOT a `{%` template → **error** + quick-fix "Wrap the handler in a `{% … %}` template" (keeps a shebang outside). FN-2 (**UC8013**) — a `{%` template that defines `handle_request` as a local function / `export function` / `let`-`const` binding (never `global.handle_request`) → **error** + quick-fix "Register as `global.handle_request`" (funcdecl → `global.handle_request = function…;` anchoring the `;` on the body brace; let/const → `global.handle_request = …`). Both are errors (0.7.57): each ALWAYS breaks the handler ("declares no handle_request() callback") — a true positive shifted from post-deploy runtime to edit-time. Also suppresses the misleading UC1006 "unused" on a `handle_request` in a template. Classified by `isTemplateFile` + `global.handle_request` presence (both tracked on the analyzer). | B | ✅ 0.7.55 (severity→error 0.7.57) |
| E | FN-5 — the `uhttpd` ambient is now a registered object type (`uhttpd` KnownObjectType, uhttpdTypes.ts) declared ONLY in handler context, so `uhttpd.recv()` types `string \| null`, `uhttpd.docroot` types `string`, and `uhttpd.snd()` flags UC5004. Removed from KNOWN_HOST_GLOBALS (was unconditional) → a non-handler file referencing `uhttpd` now gets UC1001. (FN-3 dropped.) | B | ✅ 0.7.56 |

**Status: all phases A–E shipped (0.7.53–0.7.56).** Remaining report items are non-issues:
FN-3 was a false premise (dropped); the residual UC7003 "add JSDoc" *suggestion* on the
handler fn is not a correctness FP. The false-positive side was resolved by template mode
(0.7.0) in the LSP *server*, then in the **CLI checker** in **0.7.57** — `src/cli.ts`
hardcoded `rawMode: true` and never called `detectTemplateMode`/`bridgeTemplateTokens`, so
`ucode-lsp handler.uc` (as opposed to the editor) still emitted the UC6001/UC3007/UC1002
cascade on a valid `{%` handler; the CLI now mirrors the server path. Handler authoring is
now supported end-to-end in both entry points: detection (B), runtime-footgun warning (C),
authoring quick-fixes (D), and a typed, gated ambient (E).

---

## Original report (v0.7.15)

## TL;DR

`ucode-lsp` has **no model of "this `.uc` file is a uhttpd handler."** uhttpd handlers
are ucode **templates** with a specific runtime contract. Because the LSP analyzes every
`.uc` as a plain script/module, it gets uhttpd handlers **exactly backwards**:

- **False positives** — it rejects a *correct* handler (a `{% … %}` template) with a
  cascade of parse/scope/unused errors.
- **False negatives** — it accepts a *broken* handler (an ordinary script/module that
  uhttpd cannot dispatch) with a clean bill of health.

Both stem from one missing concept: *handler-file awareness* (template mode + the
uhttpd runtime contract).

---

## Ground truth: the uhttpd ucode handler contract

From `uhttpd/ucode.c` (verified by running it):

| Fact | Source / evidence |
|---|---|
| Handler is compiled as a **ucode template** (not script/module). The file must be a `{% … %}` block; anything outside `{% %}` is emitted as literal body text. | `uc_compile(...)` in template mode; official `examples/ucode/handler.uc` begins with `{%`. |
| uhttpd finds the entry point via `ucv_object_get(uc_vm_scope_get(vm), "handle_request")` — i.e. a **global** named `handle_request`, in the VM scope. | `ucode.c:303`, `#define UH_UCODE_CB "handle_request"` |
| `uhttpd` is an **ambient global** injected into the handler's scope: `.send`, `.sendc`, `.recv`, `.urldecode`, `.urlencode`, `.docroot`. Entry is `handle_request(req)`. | `ucode.c:247` (`ucv_object_add(uc_vm_scope_get(vm), "uhttpd", v)`) |
| The handler VM sets `vm->output = /dev/null`; per-request exceptions are **swallowed** → the client sees an **empty response** with no stderr. | `ucode.c:271` |
| `import` **works** inside the template (our real `rpc.uc` import chain runs fine). | container: `challenge` returns a valid response through the real handler. |
| `loadfile(...)()` and `include(...)` **hard-abort** the handler VM — uncatchably (empty response, no stderr). `loadstring(...)()` and static `import` are safe. | container: see table under FN-4. |

Reproduce the environment:
```sh
docker run -d --platform linux/amd64 --name owrt openwrt/rootfs:x86-64-24.10.7 sleep infinity
docker exec owrt sh -c 'mkdir -p /var/lock; echo nameserver 1.1.1.1 >/etc/resolv.conf; \
  opkg update && opkg install ucode-mod-digest uhttpd-mod-ucode'
# then: uhttpd -p 127.0.0.1:80 -h /www -o /rpc -O /path/handler.uc
```

---

## Part 1 — FALSE POSITIVES (ucode-lsp rejects a *correct* handler)

Input: the canonical, working handler (verified end-to-end in the container):

```ucode
{%
'use strict';
import { handle } from './rpc.uc';
global.handle_request = function(env) {
    uhttpd.send('Status: 200 OK\r\n\r\n' + sprintf('%J', handle(uhttpd.recv() ?? '', {}, {})));
};
%}
```

`ucode-lsp` output on this **correct** file:

| Code | Message | Why it's wrong |
|---|---|---|
| `UC6001` | Unexpected token in expression (at `{%`, col 2) | Template opener not recognized — the LSP parses the file as a raw script. |
| `UC3007` | Import declarations may only appear at the top level of a module | The `{%` mis-scoping put `import` "inside a block". In template mode it *is* top-level. |
| `UC1002` | Undefined function: `handle` | The `import` was discarded due to the above, so `handle` looks undefined. |
| `UC1006` | Variable `handle_request` is declared but never used | The LSP doesn't know uhttpd invokes `handle_request`; it's the entry point, not dead code. |

**Root cause:** no ucode-**template** parsing, and no awareness that this file is a
uhttpd handler whose `handle_request` is called by the host.

---

## Part 2 — FALSE NEGATIVES (ucode-lsp accepts a *broken* handler)

Each of these is accepted clean by `ucode-lsp` but **fails at runtime** under uhttpd.

### FN-1 — Handler is not a template
```ucode
'use strict';
import { handle } from './rpc.uc';
global.handle_request = function(env) { /* ... */ };
```
LSP: clean (valid module). uhttpd: the whole file is emitted as literal body text, no
code runs → **`Error: The ucode handler declares no handle_request() callback.`**
→ *A file used as a uhttpd handler must start with a `{%` template block.*

### FN-2 — `handle_request` not registered as a global
uhttpd looks in the VM scope only. All of these are accepted by the LSP but **not found**
by uhttpd (verified — each yields "declares no handle_request() callback"):
```ucode
{% function handle_request(env) { } %}          // top-level fn is a LOCAL, not a global
{% export function handle_request(env) { } %}   // export ≠ VM scope
{% return { handle_request: function(env){} }; %}  // return value is ignored
```
Only this works:
```ucode
{% global.handle_request = function(env) { }; %}
```
→ *In a handler, require `global.handle_request = <callable>`; flag the local/export/
return forms.*

### FN-3 — `global` is context-dependent and the LSP doesn't model it
`global.handle_request = …` is **correct in a handler** (uhttpd populates the scope) but
**throws at runtime in a plain script / CLI module**:
```
$ ucode -e 'global.x = 1'
Reference error: left-hand side expression is null
```
*Partial credit:* v0.7.15 already emits **`UC8004`** ("Global 'X' is assigned only inside
function … a read of a missing global is null (non-strict) or throws under 'use strict' …")
and even suggests a `/** @global X */` annotation — so the reachability half is covered.
What's still missing is the **context** half: `global` should be modelled **null in
script/CLI-module context, object in template/handler context**, so `global.X` is a
hazard in the former and correct in the latter.

### FN-4 — `loadfile()()` and `include()` abort the handler VM (uncatchable)
Reachable-from-handler use of these silently kills the request — no response, no stderr,
and `try/catch` does **not** help. Container results (real uhttpd):

| in handler body | result |
|---|---|
| `loadfile("/x.uc")()` | **EMPTY — VM abort (uncatchable)** |
| `include("/etc/hostname")` | **EMPTY — VM abort (uncatchable)** |
| `loadstring("return 1")()` | OK |
| static `import x from './x.uc'` | OK |
| `require("fs")` | OK |
| `sourcepath()` | OK |

This bit us directly: an object dispatcher built on `loadfile(objects/${name}.uc)()`
worked perfectly under `ucode -S` and in every stubbed test, but **every authed request
returned empty on real uhttpd.** The fix was static `import`.
→ *Flag `loadfile()`/`include()` (and `loadfile(...)()`) reachable from a handler; suggest
static `import`. (`loadstring` is safe.)*

### FN-5 — the `uhttpd` ambient global
`uhttpd.send(...)` etc. are undeclared in source (host-injected). v0.7.15 already
recognizes a `/** @global X */` annotation (the `UC8004` message suggests it), so the
mechanism exists — what's missing is making `uhttpd` (with typed members
`send/sendc/recv/urldecode/urlencode/docroot`) and `handle_request` **automatic** in
handler context, rather than requiring a hand-written `@global` per file.

---

## Part 3 — Recommended ucode-lsp behavior

1. **Detect handler files.** Heuristics, any of:
   - referenced by a uhttpd config `list ucode_prefix '<url>=<file>'` or CLI `-O <file>`;
   - first non-whitespace token is `{%` **and** the file assigns `global.handle_request`;
   - a project-level glob/setting (e.g. `ucode.uhttpdHandlers`).
2. **Parse ucode template mode** (`{% %}` + literal text). Fixes FP-1..FP-3.
3. **Treat `handle_request` as an entry point** in handler files (suppress UC1006; fixes FP-4). Conversely, **require** `global.handle_request = <callable>` and flag its absence or a local/`export`/`return` form (FN-1, FN-2).
4. **Seed ambient symbols in handler context:** the `uhttpd` object (typed members
   `send/sendc/recv/urldecode/urlencode/docroot`) and the `env`/`req` argument shape
   (FN-5).
5. **Model `global` nullability by context** (FN-3): null in script/CLI-module, object in
   template/handler.
6. **Diagnose VM-aborting builtins in handlers** (FN-4): `loadfile`, `loadfile()()`,
   `include` reachable from a handler → warning, suggest static `import`. (`loadstring`
   and `import` are safe.)

### Suggested new diagnostic codes
| Code | Severity | Trigger |
|---|---|---|
| `UC7101` | error | handler file is not a `{%` template |
| `UC7102` | error | handler defines no `global.handle_request` (or defines it as local/export/return) |
| `UC7103` | warning | `loadfile`/`include` reachable from a uhttpd handler (aborts the VM) |
| `UC7104` | info | `global.X` used where `global` is null (non-handler script/module) |

---

## Repro corpus
Minimal, self-contained reproductions of the false **negatives** are in
[`../lsp-repros-uhttpd.uc`](../lsp-repros-uhttpd.uc). ucode-lsp does not flag the
handler-fatal semantics in them (it may emit unrelated diagnostics — `include()`
arg-type, `UC1006`, `UC8004`). The false **positive** repro is simply the correct handler
in Part 1 — run `ucode-lsp` on `files/usr/share/gl-ucode/handler.uc` to see UC6001 /
UC3007 / UC1002 / UC1006 on valid template code.
