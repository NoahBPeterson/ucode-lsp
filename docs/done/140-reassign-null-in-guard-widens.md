# Reassigning to `null` inside a narrowed block widens to `unknown`, suppressing the strict diagnostic

**Severity: low (over-narrow / stale state).** Inside an `if (x)` block, a subsequent `x = null` makes `x` lose its precise `null` type (becoming `unknown`), which silences the strict "got null" diagnostic the LSP raises for the same code outside a guard.

## Reproduction

```ucode
import { readfile } from 'fs';
let x = readfile('/a');
if (x) { x = null; substr(x, 0, 2); }     // CLEAN
```

But the control without the guard:

```ucode
let x = 'hi'; x = null; substr(x, 0, 2);   // "Function 'substr' expects string ... but got null"
```

Hover proof: inside the guard after `x = null`, hover shows `x : unknown`; the same `x = null` outside a guard hovers `x : null`. So entering a narrowed scope makes a later same-block assignment fall to `unknown`.

## Why it matters

The LSP is inconsistent with its own control case purely due to the surrounding guard. (It's a lint-quality issue — `substr(null,...)` returns null at runtime, no crash — but the LSP itself raises the "got null" check in the unguarded case.)

## Fix

A reassignment inside a narrowed block should set the variable's type from the RHS (here `null`), not widen it to `unknown`.
