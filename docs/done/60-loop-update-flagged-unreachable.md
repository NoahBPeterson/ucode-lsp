# A `for`-loop update expression after an unconditional `break` is flagged as "Unreachable code"

**Severity: low (confusing UX).** When a `for` loop body unconditionally `break`s, the loop's *update* expression (`i++`) is reported as `UC4001 "Unreachable code detected"` — technically true, but flagging a loop-header fragment reads as a confusing diagnostic.

## Reproduction

```ucode
for (let i = 0; i < 3; i++) {     // UC4001 lands on the `i++` update
    break;
}
```

## Root cause

`src/analysis/cfg/cfgBuilder.ts` (≈ lines 428-433) puts the loop update in its own CFG block, which becomes unreachable when the body always breaks. The reachability conclusion is correct, but pointing "Unreachable code" at a `for`-header sub-expression is misleading — a developer expects unreachable-code diagnostics on *statements*, not loop machinery.

## Fix

Suppress UC4001 for the synthetic loop-update block (or special-case it with a clearer message like "loop update never runs because the body always exits"). Don't surface CFG-internal header fragments as ordinary unreachable-code.
