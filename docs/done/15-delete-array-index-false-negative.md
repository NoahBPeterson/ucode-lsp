# `delete arr[i]` is a real ucode error but the LSP reports nothing (false negative)

> **STATUS: FIXED in 0.6.220.** `delete arr[i]` (computed member access on a provably-array receiver) now emits UC2002. `delete obj.k` / `delete obj[k]` and unknown/union receivers stay clean. New `checkDeleteExpression` + a `visitDeleteExpression` in the analyzer to drive it. Tests: `tests/test-false-negative-batch.test.js`.

**Severity: low (missed diagnostic).** `delete` on an array element is a runtime error in ucode, but the LSP accepts it silently. This is a *false negative* — a class of genuine error the linter fails to catch.

## Reproduction

```ucode
let a = [1, 2, 3];
delete a[0];          // LSP: no diagnostic
```

Verified vs `/usr/local/bin/ucode`:

```
$ ucode -R -e 'let a=[1,2,3]; delete a[0];'
Reference error: left-hand side expression is not an object
```

`delete` operates only on object keys; on an array index it throws. The valid form is correctly accepted by both:

```ucode
let o = {a:1, b:2};
delete o.a;           // valid in ucode; LSP clean
```

## Why it matters

The LSP is otherwise very faithful to ucode's grammar — it correctly rejects destructuring, default parameters, labeled `break`, `.5` float literals, trailing commas in calls, etc. (all genuinely unsupported by ucode). `delete arr[i]` is a gap in that coverage: it looks plausible, is a common mistake when porting from JavaScript (where it is allowed), and silently passes review here.

## Fix

When the operand of `delete` resolves to array-element access (`expr[index]` where `expr` is typed `array`), emit an error mirroring ucode's: *"delete operates on object properties; the left-hand side is an array."*
