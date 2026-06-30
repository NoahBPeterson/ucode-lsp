# `push(arr)` / `unshift(arr)` with no value-to-push returns a leaked stale type, not `null`

**Severity: low (non-deterministic inference).** The 1-argument form of `push`/`unshift` returns `null` in ucode, but the LSP types it as whatever type a *prior* builtin call left in a shared field.

## Reproduction

```ucode
let a = ['x', 'y'];
let r = push(a);          // hover r: integer (or whatever leaked) — should be null
```

`push([])`, `push(['x'])` all hover `integer` regardless of element type. Verified: `type(push([1,2]))` → null (C `uc_push` leaves `item = NULL` and returns `ucv_get(item)`).

## Root cause

`validatePushFunction`/`validateUnshiftFunction` (`builtinValidation.ts:1685, 1729`) only set `narrowedReturnType` when `arguments.length >= 2`. In the 1-arg case they leave the shared `this.narrowedReturnType` untouched, and it is only reset to `null` *after* a special-builtin call (`typeChecker.ts:1920`) — so a value leaked from a prior builtin call in the same pass surfaces. (A latent hazard for any handler that returns true without setting the field.)

## Fix

Explicitly set `narrowedReturnType = UcodeType.NULL` in the no-value `push`/`unshift` path.
