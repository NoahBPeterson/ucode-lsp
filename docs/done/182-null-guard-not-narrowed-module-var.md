# UC5005 false positive — an `if (!x) return` guard does not narrow a module-level `let` inside a function

> **STATUS: FIXED.** `collectGuards`'s early-exit fall-through handler in `typeChecker.ts`
> only removed null when the variable's effective type was a `T | null` UNION; a variable
> typed EXACTLY `null` (the case below) fell through and stayed null. Now, after
> `if (!x) <early-exit>` on a bare-`null` variable, it narrows to `unknown` (provably
> non-null on the fall-through). SOUND-GATED via `isVariableAssignedBetween`: an intervening
> reassignment to null still flags. Also fixed a stray NUL byte in typeChecker.ts found en
> route (it made the file read as binary to grep). Regression test:
> `tests/diagnostics/test-null-guard-early-return.mocha.js`.

**Severity: medium (false positive).** A module-scoped `let` that starts out `null` and is
assigned later keeps its `null` type *inside a nested function even after an early-return
null-guard*, so a guarded member access is wrongly flagged as a null dereference. The idiom
(lazy-initialised module singleton + `if (!ctx) return …;` guard) is extremely common.

## Reproduction (real code — netifd proto loader)

```ucode
import { sorted_json } from "./utils.uc";
import { dirname, glob } from "fs";

let ctx;

function proto_config_load(config_fn, section_name)
{
    if (!ctx)
        return null;                                       // <-- guard: ctx is truthy below

    let section_data = ctx.get_all("network", section_name); // UC5005: "'ctx' is null here" ❌
    ...
}

function config_init(uci)
{
    ctx = uci;                                             // ctx assigned before any call
    ...
}

return { config_init };
```

The LSP reports on the `ctx.get_all(...)` line:

> Cannot access property 'get_all' of a null value ('ctx' is null here) — this is a runtime
> error in ucode. Use optional chaining (?.) if the value may be null. **UC5005**

## Proof it is a false positive (server-verified, minimal)

```ucode
let ctx;
function f(n) {
  if (!ctx) return null;            // early-return null-guard
  let d = ctx.get_all("network", n); // still UC5005 ❌
  return d;
}
function init(uci) { ctx = uci; }
```

Running this through the server, the `if (!ctx) return null;` guard makes **no difference** —
UC5005 fires identically with and without it:

| variant | UC5005 on `ctx.get_all` |
|---|---|
| with `if (!ctx) return null;` guard | **fires** (wrong) |
| without the guard | fires |

After `if (!ctx) return null;`, `ctx` is provably non-null on the only path that reaches the
access, so the access is safe. The guard *should* eliminate the diagnostic; that it changes
nothing proves the early-return narrowing is not applied to the closed-over module variable.

## Why it is wrong (two independent reasons)

1. **The guard is sound here and is being ignored.** ucode is single-threaded and the access is
   in the same synchronous function as the guard with no intervening reassignment of `ctx`, so
   `if (!ctx) return;` narrows `ctx` to non-null for the rest of the body — exactly like the
   in-function narrowing the engine already does for locals. The bug is that this narrowing is
   not applied when the guarded variable is a **module-level `let` referenced from inside a
   nested function** (closure capture).
2. **The declaration-time type is over-trusted.** `let ctx;` makes `ctx`'s type `null` at the
   point of definition, and that is what the function body sees. But `ctx` is assigned in
   `config_init()` before `proto_config_load()` is ever called; the analyzer can't prove call
   order, which is *exactly why the guard exists* — and is the signal it should honor.

## Fix direction

Apply early-return / `if (!x) return` narrowing to closed-over module-scope variables within a
function body (the same truthiness-narrowing already done for locals), keyed by the absence of
an intervening reassignment between the guard and the use. Until then this idiom forces a
spurious `?.` or a diagnostic suppression on correct code.

(Related: the broader question of how a module-level `let` reads back inside a function — see
also `docs/done/flow-reassignment-union-call-gap.md` for an adjacent flow-typing gap.)
