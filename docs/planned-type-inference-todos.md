# Planned: type-inference follow-ups

Captured 2026-06-08. `require("builtin")` is now generically typed as that module
(0.6.18x) — it flows through property assignment, variable binding, member reads, and
member calls (e.g. `o.fs = require("fs"); let a = o.fs; a.glob("x")` → `array<string> |
null`). These are the remaining gaps, in rough priority order.

## 1. File-path `require()` typing
`require("./file.uc")` / dotted-module `require("a.b.c")` should resolve to that file's
module type (cross-file), like the builtin case. Today only **builtin** modules are
typed by `require()`; file-path requires fall back to the existing commonjs/default-
import handling (binding only). Needs the cross-file resolver in the generic
`require()` return-type path.

## 2. Member call on a non-variable module expression
`require("fs").glob("x")` (inline) and `o.fs.glob("x")` (property-member call, no
intermediate variable) return `unknown` — the module type is correct on the
sub-expression, but the member *call* doesn't resolve its return type without an
intermediate binding. Same family as the inline-chain completion limitation. Bind to a
var (`let a = o.fs; a.glob()`) as the workaround today.

## 3. Plain-variable reassignment to `require()`
`let m; m = require("fs");` (assignment, not declarator init) doesn't carry the module
type to `m`. `let m = require("fs")` (init) and `obj.x = require("fs")` (property) both
work; this is the bare-`let`-then-assign case. SSA carries plain types on reassignment
but drops the module type here.

## 4. Cross-function implicit-global typing
An implicit global (bare `x = …`) assigned in one function and read in another is
typed only inside the assigning function (the symbol is function-scoped). To type it
everywhere it should be declared at module scope, typed by the union of its assignment
RHS types (and bare-for-in element types). Today: `gv = fs.basename("x")` in `init()`,
read in `use()` → no hover.

## 0. PERF: workspace scan on large trees (shebang-peek cost)
The 0.6.182 shebang detection reads the first 128 bytes of **every extensionless file**
during the workspace walk (`scanAndAnalyzeWorkspace`, `listWorkspaceUcodeFiles`). In a
workspace that contains a big vendored tree (e.g. an OpenWrt checkout — ~3.4k
extensionless files, 45k total), this makes the scan slow enough to stall the server on
startup (it stalled the test harness, which uses cwd as the workspace). Mitigations to
consider: skip the peek for non-executable files (needs a cheap stat), cap total peeks,
respect `.gitignore`, run the walk fully async/yielding, or skip obviously-vendored
subtrees. (Today, gitignoring or not nesting such trees under the workspace avoids it.)

## 5. Host-context (parameter shape) typing
The real uvol `ubi.uc` does `fs = ctx.fs` where `ctx` is an untyped parameter and the
host sets `ctx.fs` externally — so `ctx.fs` is genuinely unknowable and `fs` correctly
becomes `unknown` (most-recent semantics; NOT something to "fix" with an unsound import-
keeps-its-type hack). To improve it, `ctx`'s shape must be declarable — e.g. a JSDoc
`@param` with a typed object shape, or the planned runtime-introspection /
`.ucode-lsp.json` host-globals config (see planned-runtime-introspection.md). Until
then, host-provided context members stay `unknown` by design.
