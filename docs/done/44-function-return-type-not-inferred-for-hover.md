> ✅ **FIXED** (verified 2026-06-15 triage). `semanticAnalyzer.ts:1853-1862` stamps `symbol.returnType` via `getCommonReturnType` for named function declarations; `hover.ts:1066` renders it as `Returns: `<type>``. Confirmed live: hover on `function f(x){ if(x) return "a"; return 1; }` → `Returns: `string | integer``.

# User-function hover always shows `Returns: unknown` — return type never inferred onto the symbol

**Severity: low-medium (hover/inference content).** Even a trivially inferable return type is shown as `unknown` on function hover.

## Reproduction

```ucode
function greet() { return "hi"; }     // hover: Returns: unknown   (should be: string)
function add(a, b) { return a + b; }   // hover: Returns: unknown
```

## Root cause

`src/hover.ts:1043` faithfully renders `symbol.returnType`, but the analyzer never stamps a concrete return type onto the function symbol — it stays `unknown` even for a single `return "hi"`. So the gap is upstream of hover, but the user-visible effect is the always-`unknown` hover.

## Why it matters

A function that returns a literal/typed value gives no type information at its call sites or on hover, weakening downstream inference (callers see `unknown`). Inferring the return type from a single obvious literal return (or a union of returns) would be a meaningful improvement and would compose with the existing factory-return-type machinery.

## Fix

Infer and stamp `symbol.returnType` from the function body's `return` statements (start with the single-literal-return case), so both hover and call-site inference improve.
