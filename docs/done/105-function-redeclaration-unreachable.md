# UC1007 (function redeclaration) is unreachable — a redeclared function is silently accepted even in strict mode

> **STATUS: FIXED in 0.6.220.** Strict-mode function redeclaration of an already-realized same-scope name now emits UC1007 (mirrors UC1003 for `let`; non-strict = last wins). `realizedFunctions` set tracks the first real visit past the hoist pre-pass. Tests: `tests/test-false-negative-batch.test.js`.

**Severity: medium (false negative + dead code).** Declaring the same function name twice is a hard syntax error in ucode, but the LSP emits nothing — and the `UC1007` code meant to catch it can never fire.

## Reproduction

```ucode
'use strict';
function f(){ return 1; }
function f(){ return 2; }      // LSP: nothing (only an unrelated UC1006)
```

Verified: `ucode -R -e '"use strict"; function f(){return 1;} function f(){return 2;} print(f());'` → `Syntax error: Variable 'f' redeclared`. The `let` analog *is* caught (`let a=1; let a=2;` → UC1003 Error).

## Root cause

`semanticAnalyzer.ts:1419-1442`: the `hoistFunctionDeclarations` pre-pass already declared `f` as a FUNCTION, so on the second declaration `alreadyHoisted` is true → it takes the `else` branch and silently overwrites the symbol. The `UcodeErrorCode.FUNCTION_REDECLARATION` emit (line 1428) is in the unreachable `!alreadyHoisted` branch. So `UC1007` can never fire and a real syntax error is missed.

## Fix

Detect a second `function NAME` declaration of an already-hoisted name (in the same scope) and emit `UC1007` (Error in strict mode, matching how `let` redeclaration is handled).
