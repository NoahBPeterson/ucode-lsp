# Architectural Debt

## Nullable Object Types in Method Resolution

**Status:** Open
**Introduced:** 0.6.23 (made visible by unifying module return type inference)
**Affects:** hover, completions, method validation for module function return values

### The Problem

Two systems infer return types for module function calls:

1. **Type checker** (unified, correct): looks up `MODULE_REGISTRIES[module].getFunction(name)`, parses the return type string. Correctly includes `| null` for functions that can fail at runtime (e.g., `io.open()` → `io.handle | null`).

2. **Semantic analyzer cascade** (legacy, per-module): `inferFsType()`, `inferIoType()`, `inferNl80211Type()`, `inferUloopType()`, `inferUciType()` — detects module function calls and creates `ModuleType` objects. Intentionally drops `| null` because downstream code can't handle nullable object types.

The `_fullType` guard in `visitVariableDeclarator` (line ~504) prevents the type checker's correct nullable type from overwriting the cascade's non-nullable type. This is necessary because:

- `hover.ts` checks `'moduleName' in symbol.dataType` — fails on `UnionType`
- `completion.ts` checks `'moduleName' in symbol.dataType` — fails on `UnionType`
- `definition.ts` checks `'moduleName' in symbol.dataType` — fails on `UnionType`
- Method validation checks the same shape

### The Fix

1. Update all `'moduleName' in dataType` checks to also handle `UnionType` containing a `ModuleType`:
   - Extract the `ModuleType` member from `X | null` unions
   - Use it for method lookup, hover docs, and completions
   - The `null` member should trigger "value might be null" warnings on method access

2. Remove the `_fullType` guard (the `alreadyModuleType` check in `visitVariableDeclarator`)

3. Remove the semantic analyzer's `inferXType` cascade — the type checker's unified path via `MODULE_REGISTRIES` replaces it entirely

4. Remove per-module `createXDataType()` factory functions — `parseSingleType` already creates compatible `ModuleType` objects

### Related Bugs Fixed in 0.6.23

- `inferNl80211Type` matched `listener` by bare name → `rtnl.listener()` got `nl80211.listener` type
- `inferUloopType` matched `signal` by bare name → builtin `signal()` got `uloop.signal` type
- Both fixed by adding `importedFrom` checks, but the cascade approach remains fragile

### Files Involved

- `src/analysis/semanticAnalyzer.ts` — cascade methods + `_fullType` guard
- `src/analysis/typeChecker.ts` — unified `MODULE_REGISTRIES` path
- `src/hover.ts` — `'moduleName' in dataType` checks
- `src/completion.ts` — `'moduleName' in dataType` checks
- `src/definition.ts` — `'moduleName' in dataType` checks
- Per-module type files: `fsTypes.ts`, `ioTypes.ts`, `nl80211Types.ts`, `uloopTypes.ts`, `uciTypes.ts`
