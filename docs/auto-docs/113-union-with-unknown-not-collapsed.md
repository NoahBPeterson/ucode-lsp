# `||` / `??` result type leaks an `unknown | T` union that should collapse to `unknown`

**Severity: low (hover/type formatting).** A union that contains `unknown` is not reduced — `unknown | integer` leaks into hover instead of collapsing to `unknown` (a union with `unknown` is just `unknown`).

## Reproduction

```ucode
function f(a) { let x = a || 5; return x; }     // hover x: `unknown | integer`   (should be: unknown)
```

(`a` is an unknown param; `a || 5` is `unknown` or `integer` → the type is just `unknown`.)

## Root cause

The union builder doesn't absorb `unknown` — `unknown | T` should simplify to `unknown` (it's the top type). The raw widened union leaks into hover and any other type display.

## Fix

In the union constructor/normalizer, collapse any union containing `unknown` to `unknown` (and dedupe/simplify members generally). Low severity, but it makes hovers and downstream displays cleaner and avoids confusing `unknown | X` types.
