> 🟡 **PARTIAL** (2026-06-15 triage). `clock` (builtins.ts:56 → `number[] | null`) and `gc` (line 58, per-operation return detail) are fixed. STILL STALE: `min`/`max` (lines 37-38) say "Returns: number"; `sourcepath` (line 57) says "Returns: string" (missing `| null`).

# Stale hover doc-strings show wrong return types for `min`/`max`/`clock`/`sourcepath`/`gc`

**Severity: low (hover content).** The type *engine* (`typeChecker.ts`) models these builtins' return types correctly, but the human-readable hover doc-strings in `src/builtins.ts` disagree, so hover shows wrong "Returns:" lines.

## Findings (verified against the interpreter)

| builtin | hover doc says | actual return | engine models |
|---|---|---|---|
| `min` / `max` | `Returns: number` | any type (`max("a","b")` → `"b"`, `max(true,false)` → `true`) | `unknown` ✅ |
| `clock` | `Returns: null` | `[sec, nsec]` integer array (`lib.c:5207`) | `array` ✅ |
| `sourcepath` | `Returns: string` | `string \| null` (`lib.c:4437`; null at top level) | `string\|null` ✅ |
| `gc` | `Returns: true` | `boolean \| integer \| null` (`gc("count")` → integer) | per-op narrowing ✅ |

So the diagnostics/type-flow are right; only the hover text is misleading.

## Fix

Update the `Returns:` lines in `src/builtins.ts` for these five to match reality (and the engine). Purely a documentation-string fix.
