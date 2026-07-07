# Implicit-global type inference — findings & design

Status: **investigated, not implemented** (handed to a parallel agent).
Date: 2026-06-08. Follow-on to 0.6.183/0.6.184 (non-strict implicit-global UC1001 suppression).
Sample corpus: `packages/utils/uvol/files/lvm.uc`, `ubi.uc`.

## Background

0.6.183/0.6.184 made bare assignments to undeclared names (non-strict) *provable implicit
globals* and suppressed UC1001 on them. The implementation (`collectImplicitGlobalNames`,
semanticAnalyzer.ts:318) stores only **names** in a `Set`, consulted at two suppression
sites (visitIdentifier:1784, typeChecker undefined-function:1767).

It never creates a **symbol**. So an implicit global has:
- no type stamped from its assignment RHS, and
- nothing in `symbolTable.lookup(name)` — any code path keyed on `lookup()===null`
  behaves as if the name is undefined.

Contrast `hoistBareRequireModules` (semanticAnalyzer.ts:355): same shape, but it *does*
`symbolTable.declare(name, MODULE, …)` for `name = require("mod")`. The implicit-global
pass is that pattern stopped one step short.

## Finding 1 — the `fs` UC3006 storm is now a FALSE POSITIVE (highest value)

`fs = ctx.fs` (lvm.uc:117, ubi.uc:59) marks `fs` a provable implicit global → UC1001
suppressed. But `validateModuleMember` (semanticAnalyzer.ts:1929-1939) fires UC3006
whenever `lookup("fs")===null` **and** `fs` is a known module name. No symbol ⇒ `null`
⇒ UC3006 fires anyway:

```
lvm.uc:20,35,102,103,394,395   ubi.uc:8,26,32,35,49,111   (12 total)
"Cannot use 'fs' module without importing it first. Add: import { popen } from 'fs'; …"
```

This is **self-contradictory**: we declared `fs` a defined implicit global, yet advise
`import fs` — wrong (it's a local holding `ctx.fs`) and impossible to act on. Pre-0.6.183
this was UC1001+UC3006; the implicit-global work cleared UC1001 but left UC3006, leaving
`fs` half-diagnosed.

**Just creating a symbol — even typed `unknown` — kills all 12**, because the `!symbol`
branch stops firing.

## Finding 2 — inferable types currently discarded

Per the project principle (infer only from an *observed origin*: literal / builtin-return /
assignment — never from param body-usage), an implicit global assigned from a **local
function return or builtin** is fair game; the assignment IS the observed origin.

| Implicit global | Assignment | Inferable? | Payoff once typed |
|---|---|---|---|
| `vg` | `vgs(vg_name)` (lvm.uc:125) | Yes — local fn → `object \| null` | `!vg` guards + `vg.vg_extent_size`/`vg_free_count` checks (lvm.uc:134,137,144,281,362) |
| `vg_name` | `pvs()` (lvm.uc:121) | Yes — local fn return | `if (!vg_name)` null-flow |
| `ebsize` | `read_file(...)` (ubi.uc:77) | Yes — local fn → `string \| null` | arithmetic/null checks |
| `ubidev` | `null`, `fs.basename(...)` (ubi.uc:60,70) | Yes — `string \| null` | — |
| `fs`, `cursor`, `uvol_uci_add/commit/remove/init` | `ctx.fs`, `ctx.cursor`, `ctx.uci_*` | No — `ctx` is a param, member ⇒ `unknown` | symbol still kills the `fs` FP; type stays `unknown` (correct) |

The hint case `uvol_uci_add = ctx.uci_add` is the **boundary**: the missing *mechanism*
(carry the assignment type into a symbol) is the point; this RHS resolves to `unknown`
because `ctx` is a param, and that is the correct stopping point. The win is the symbol
existing, not its type.

## Out of scope (different root causes)

- **`backend.*` UC1001 ×17** (lvm.uc:452-468): `backend` is assigned only via *member*
  writes (`backend.backend = …`), so the collector (keys on `left.type==='Identifier'`)
  never sees it. It's a host global injected by the parent `include()`r → the
  "needs runtime introspection" case (`docs/planned-runtime-introspection.md`).
- **`incompatible-function-argument … unknown` ×~20** (substr/rtrim/split on `lv.lv_name`,
  `r.vg_extent_size`): from `lvs()`/`lvm()` returning untyped JSON-parse objects whose
  property types are unknown — a separate inference gap (cf.
  `docs/registry-value-shape-inference.md`) that dominates the remaining noise.

## Recommended shape

A pass parallel to `hoistBareRequireModules`: for each implicit-global name,
`symbolTable.declare(name, VARIABLE, <type>, node)` where `<type>` = the RHS type when it
resolves to a literal / builtin-return / local-fn-return, else `unknown`. Single change:
(a) eliminates the 12 `fs` UC3006 false positives via the existing `!symbol` guard, and
(b) restores member/null checking on `vg`, `vg_name`, `ebsize`, `ubidev` — without
violating the param-usage principle (the `ctx.*`-sourced globals correctly land `unknown`).

Edge cases to handle:
- **Multiple assignments** to one implicit global (e.g. `ubidev = null` then `= fs.basename`):
  union the RHS types, or fall back to `unknown` if they disagree non-trivially.
- **Position**: implicit globals are module-scoped (persist after the assigning function),
  so declare at module scope like `hoistBareRequireModules` does — don't position-gate.
- Don't regress the suppression sets; the name-Set still drives UC1001/undefined-function
  suppression, the new symbols are additive.
