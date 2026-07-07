# Analyzer crash: module-typed value as builtin argument (`type(fs)`) kills whole-file analysis

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

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
