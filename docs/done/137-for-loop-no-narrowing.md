# `for (; cond; )` loop body gets no type narrowing (false positive)

> **STATUS: FIXED in 0.6.219.** `collectGuards` (typeChecker.ts) now has WhileStatement + ForStatement cases that apply the loop condition as a positive guard in the body, mirroring the if-consequent. Tests: `tests/test-loop-condition-narrowing.test.js` (8).

**Severity: low-medium (false positive).** Like `while` (finding 136), a `for`-loop condition does not narrow the subject in the body.

## Reproduction

```ucode
import { readfile } from 'fs';
let x = readfile('/a');
for (; x; ) { substr(x, 0, 2); break; }     // "Argument 1 of substr() may be null"
```

The identical `if (x)` form is CLEAN. Verified: the for-condition being truthy guarantees `x` non-null in the body. Affects `for(;x;)`, `for(;x!=null;)`.

## Root cause

Same as finding 136 — `collectGuards` (`typeChecker.ts ~3551`) has no `ForStatement` branch; `visitForStatement` (`semanticAnalyzer.ts:2618`) doesn't apply the test as a guard.

## Fix

Apply a `for`-statement's condition as a positive guard within the loop body (same fix as 136).
