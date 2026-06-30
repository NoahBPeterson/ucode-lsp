# Member completion fails on a ternary / `||` / `??` result (the `opts || {}` idiom)

**Severity: low-medium (completion).** Completing after `(o || {}).` (or a ternary / `??` result) floods with builtins instead of the object's members, even though hover knows the base type is `object`.

## Reproduction

```ucode
let o = { aa: 1 };
let r = o || {};
r.          // completion → builtins/keywords; should offer `aa`
```

Same for `let r = true ? o1 : o2; r.` and `let r = o ?? x; r.`. Hover on `r` *does* report `object` — so the typeChecker computes a base type, but the full/shaped object type is dropped through `LogicalExpression`/`ConditionalExpression`, leaving completion nothing to enumerate.

## Why it matters

`let cfg = opts || {}` is an extremely common idiom; member completion is unavailable on the result.

## Fix

Propagate the full (shaped) object type — not just the base type — through `||`/`??`/ternary, so member completion can enumerate the result's properties. (Shares a root with finding 176 — object shapes lost when they flow through operators/into arrays.)
