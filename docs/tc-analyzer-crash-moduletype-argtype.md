# Analyzer crash: module-typed value as builtin argument (`type(fs)`) kills whole-file analysis

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** `getTypeDescription` now collapses ModuleType/DefaultImportType (and any other non-union/named-object/array `UcodeDataType`) to its base kind via `dataTypeToBase` instead of falling through and returning the raw object; `getNodeTypeDescription` also gained a `typeof result === 'string'` guard as defense in depth.

## The gap

Passing a **module-typed value** (a `require()` result, or an ambient daemon global like
`hostapd`/`wpas`/`netifd`) as an argument to a **null-narrowing builtin** crashes the entire
semantic analysis: one opaque `error: Semantic analysis error: argType.includes is not a function`
replaces all diagnostics, and every variable in the file loses hover.

Minimal repro (verified against the current build):

```ucode
let fsx = require("fs");
printf("%s\n", type(fsx));    // CRASH — whole file dead
let after = 1;                // `after` has no hover, no diagnostics anywhere
```

Real corpus casualties (all no-hover findings in these files are THIS crash):

- `zzzz/hostapd-demo/introspect_hostapd.uc` — 5 occurrences (`type(hostapd)` with the 0.7.66
  hostapd ambient declared)
- `zzzz/hostapd-demo/introspect_wpas.uc` — 5 occurrences (`type(wpas)`)

10 of the 1,987 no-hover audit occurrences, but the trigger (`type(require("x"))`,
`length(mod)`, any narrowing builtin over a module handle) is ordinary user code — and it takes
the 0.7.66 hostapd/wpas and 0.7.61 netifd ambients down with it, since those are module-typed
(`{ type: 'object', moduleName: 'hostapd.global' }`).

Note: an OBJECT-typed handle (e.g. `fs.open()` → `fs.file`) does NOT crash — only
moduleName-typed values do.

## Root cause (verified by bisection + code reading)

1. `type()` returns a null-containing union, so `narrowBuiltinReturnType`
   (`src/analysis/typeChecker.ts:2956`) runs and asks for the argument's type description:
   `const argType = this.getNodeTypeDescription(arg)` (`:2979`).

2. For an Identifier, `getNodeTypeDescription` (`:2106`) resolves the symbol's rich data type
   and returns `this.getTypeDescription(baseType) as UcodeType` (`:2139`).

3. `getTypeDescription` (`:2084`) handles unions (`isUnionType`), named object types
   (`isObjectType` → `.name`), and arrays — but a **ModuleType**
   (`{ type: UcodeType.OBJECT, moduleName: 'fs' }`, which has `moduleName`, NOT `name`) matches
   none of the branches and falls through to `return type as string`, **returning the raw
   object**.

4. Back in `narrowBuiltinReturnType`, `argType === 'unknown'` is false, then
   `argType.includes(' | ')` (`:2991`) throws `argType.includes is not a function`.

5. The exception unwinds to `analyze()`'s top-level catch (`semanticAnalyzer.ts:407`) → the
   whole file's analysis is discarded (only builtins remain in the symbol table).

Sibling call sites with the same `.includes(' | ')` assumption on `getNodeTypeDescription`'s
result: `typeChecker.ts:2284` (`narrowNullFromWrongType`) and
`src/analysis/checkers/builtinValidation.ts:385/1448/1806/1855/2462/2488/2649` (the validator
receives the same function via `setTypeChecker`, `typeChecker.ts:341`). Any of them crashes the
same way when handed a ModuleType.

## Proposed approach

1. **Fix `getTypeDescription`** (the single point of truth): add a ModuleType branch before the
   fallthrough — `extractModuleType(type)` → return its `moduleName` (or plain `'object'`,
   which is what `type()` would report at runtime; pick one and make narrow-compat explicit).
   `detectObjectType` (`typeChecker.ts:3020`) already shows the extractModuleType pattern.

2. **Defense in depth**: `getNodeTypeDescription` is typed as returning `UcodeType` (a string)
   — enforce it. A final `typeof result === 'string' ? result : UcodeType.UNKNOWN` guard makes
   every downstream `.includes` call crash-proof even if a future rich type slips through.

3. Sweep the `argType.includes` call sites for the same assumption (they're all safe once #1/#2
   land, but a shared `describeType(): string` helper would prevent recurrence).

## Test cases

- `let fsx = require("fs"); type(fsx);` → no crash; `type(fsx)` narrows/types normally; later
  symbols hover.
- `printf("%s", type(hostapd));` in a hostapd-context file (ambient declared) → no crash; the
  10 zzzz introspect occurrences disappear from the audit.
- `length(require("uci"))`, `index([], require("fs"))` — other narrowing builtins with a module
  arg → no crash, and the wrong-type diagnostics still fire where they should.
- Regression: `narrowBuiltinReturnType` union-narrowing tests still pass (string descriptions
  unchanged for scalar/union/named-object args).

## Classification

**Solvable** — a contained bug fix. 10 corpus occurrences directly (zzzz introspect demos), but
the crash is reachable from any user file that passes a module handle to a narrowing builtin,
and it silently disables the flagship daemon-ambient typing (hostapd/wpas/netifd) in exactly
the introspection scripts most likely to do so.

## Fix

Both hardenings from "Proposed approach" were implemented, in `src/analysis/typeChecker.ts`:

1. **`getTypeDescription`** (the single point of truth): added a final branch after the existing
   union/named-object/array/string checks — any other `UcodeDataType` (a bare `ModuleType`
   `{ type: 'object', moduleName: … }`, a `DefaultImportType`, or a future variant) is collapsed
   via `dataTypeToBase(type)` (imported from `symbolTable.ts`, already used elsewhere in this
   file as `dataTypeToUcodeType`'s implementation) instead of falling through to `return type as
   string`. `dataTypeToBase` maps module/object shapes to `UcodeType.OBJECT`, which is what
   `type()` reports for these at runtime AND matches the base-kind comparisons
   `narrowBuiltinReturnType`/`narrowFsReturnType` do against `acceptableTypes` (`'object'` is
   already in that list for `length`/`index`/`rindex`) — so the fix is narrow-compat by
   construction, not just crash-safe. Note: `DefaultImportType` had the exact same latent bug
   (its `.type` is `UcodeType.OBJECT`, not `'objectKind'`, so it matched neither `isObjectType`
   nor `isArrayType` either) — found and fixed by the same branch while sweeping the function.
2. **`getNodeTypeDescription`** defense in depth: renamed the existing method's body to
   `getNodeTypeDescriptionImpl` and added a thin `getNodeTypeDescription` wrapper that guards
   `typeof result === 'string' ? result : UcodeType.UNKNOWN` before returning — every internal
   recursive call (`this.getNodeTypeDescription(...)`) and every external caller (bound into
   `builtinValidation.ts` via `setTypeChecker`) now gets the same guarantee even if a future call
   path skips `getTypeDescription` entirely.

Sibling call sites (`narrowBuiltinReturnType` at `typeChecker.ts:~2979`, `narrowFsReturnType` —
the ticket's "narrowNullFromWrongType" — at `typeChecker.ts:~2277`, and every
`builtinValidation.ts` validator wired through `setTypeChecker`) needed no separate fix: they all
consume `getNodeTypeDescription`'s return value, so fixing it at the source fixes all of them.

Verified before/after with a throwaway build (see crash 1's fix note for the stash/rebuild
method): pre-fix, `node bin/ucode-lsp.js <file>` printed
`error: Semantic analysis error: argType.includes is not a function` for
`let fsx = require("fs"); printf("%s\n", type(fsx));` and for the real `blockdev_common.uc`/
`uci.uc` corpus files (crash 1's files also exercise this path incidentally); post-fix the
message is gone, `type(fsx)` narrows/types normally, and `--type-coverage` on the minimal repro
goes from 1 `no-hover` finding (the trailing `let after2 = 1;`, lost because the crash aborts
`analyze()` before the rest of the file is processed) to 0.

Files touched: `src/analysis/typeChecker.ts` (`getTypeDescription`, `getNodeTypeDescription`).
Regression tests: `tests/test-tc-analyzer-crashes.test.js` (describe block "crash 2: …", 3
tests, run as a CLI subprocess, including a `--type-coverage` assertion). Demo:
`zzzz/demo-tc-crashes.uc`.
