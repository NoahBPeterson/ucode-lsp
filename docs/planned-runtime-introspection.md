# Planned: runtime introspection of globals & modules

**Status:** committed TODO (not yet built). Captured 2026-06-08.

## Problem
The LSP hardcodes the set of known global functions and modules. Real ucode
environments (especially OpenWrt builds) expose **custom globals** and **custom
modules** (e.g. `ucode-mod-uline`, `ucode-mod-bpf`, hostapd's ucode bindings). Code
using them gets false "undefined"/"not exported" diagnostics, and no completion.

## Approach (verified feasible)
Introspect the actual `ucode` runtime:
- **Globals (side-effect free):** `ucode -e 'for (let k in global) printf("%s\t%s\n", k, type(global[k]))'` → name + coarse `type()` (function / array / object / double …).
- **Module exports:** `require("mod")` (or `import * as m`) then the same loop → export names + types. *Runs the module's init — side effects — so must be opt-in / scoped.*

## Hard limit
`type()` yields `"function"` only — **no parameter signatures, return types, docs**, and
no object-handle method types (those need constructing an instance). So introspection
gives **existence + coarse kind** → enough to suppress false "undefined"/"not exported"
and offer names in completion, NOT rich hover/signature-help/return-typing.

## Layered design (by safety)
1. **Tier 1 — globals (safe, opt-in, cached).** Setting `ucode.runtime.path` (default
   `ucode` on PATH) + `ucode.runtime.introspectGlobals`. Dump `global`, register unknown
   names as globals (function → callable/unknown-sig, value → `type()`-typed). Kills
   false "undefined" for env globals. Zero side effects.
2. **Tier 2 — imported-module export names (opt-in, scoped).** Only introspect modules
   the workspace actually imports (since `require` runs init). Suppresses "not exported",
   offers completion of names. Still no signatures.
3. **Tier 3 — signatures (no exec).** Parse the module's C `uc_function_list_t` + jsdoc
   when source is in the workspace (how the existing defs were built — automate it), or a
   declarative `.ucode-lsp.json` allowlist. This is where real hover/sig-help come from.

## Risks to design around
- **Binary ≠ target:** dev's `ucode` may not match the OpenWrt target → make the path
  configurable; treat introspected globals as additive (suppress, don't assert).
- **Code execution:** dumping `global` is safe; `require()` runs init → opt-in/scoped only.

## Recommended first step
Tier 1 (globals), opt-in + cached. Highest value (false-positive elimination), lowest
risk. Modules + signatures are follow-ups.

(Aside to check independently: whether the LSP is already missing any *standard* globals
— e.g. `signal`, `sourcepath`, `wildcard`, `render`, `gc`, `sleep`, `proto`, `trace`,
`loadfile`, `loadstring`, `uniq`, `b64enc/dec`, `hexenc/dec`, `timegm/timelocal`,
`gmtime/localtime`, `iptoarr/arrtoip` — a hardcoded fix independent of introspection.)
