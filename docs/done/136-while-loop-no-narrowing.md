# `while (cond)` loop body gets no type narrowing (false positive)

> **STATUS: FIXED in 0.6.219.** `collectGuards` (typeChecker.ts) now has WhileStatement + ForStatement cases that apply the loop condition as a positive guard in the body, mirroring the if-consequent. Tests: `tests/test-loop-condition-narrowing.test.js` (8).

**Severity: medium (false positive).** A truthiness/type test in a `while` condition does not narrow the subject inside the loop body, so a guarded value is still flagged nullable/unknown — unlike the identical `if` form.

## Reproduction

```ucode
import { readfile } from 'fs';
let x = readfile('/a');                 // string | null
while (x) { substr(x, 0, 2); break; }   // "Argument 1 of substr() may be null"
```

The identical `if (x) { substr(x,0,2) }` is CLEAN. Verified: inside `while (x)`, x is provably truthy (non-null), so substr always gets a string. Affects `while(x)`, `while(x != null)`, `while(type(x)=='string')`, etc.

## Root cause

`collectGuards` (`typeChecker.ts ~3551`) handles `IfStatement`/`ConditionalExpression`/`SwitchStatement` and early-exit sibling scans, but has **no `WhileStatement` case**; `visitWhileStatement` (`semanticAnalyzer.ts:2604`) never feeds `node.test` into the guard machinery.

## Fix

Apply the `while` condition as a positive guard within the loop body (mirroring `IfStatement`). This is high-value — `while ((line = handle.read('line'))) {...}` is pervasive in OpenWrt code. (Shares the gap with finding 137.)
