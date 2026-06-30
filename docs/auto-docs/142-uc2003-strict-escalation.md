# Excess positional arguments are escalated to a hard ERROR under `'use strict'` (UC2003)

**Severity: low-medium (false positive at error severity).** Calling a function with more arguments than parameters is `UC2003` — a Warning in non-strict mode but an **Error** under `'use strict'`. ucode ignores extra arguments in both modes.

## Reproduction

Real corpus: `openwrt/.../cli/context.uc:169,406` — `prepare_default(e, ctx, spec, argv, named_args, spec)` calls a 5-param function with 6 args.

```ucode
'use strict';
function f(a, b, c) { return a + b + c; }
f(1, 2, 3, 4, 5);          // UC2003 ERROR (severity 1) under strict; Warning otherwise
```

Verified: `'use strict'; function f(a,b,c){return a+b+c;} f(1,2,3,4,5)` → `6`, exit 0. ucode's `'use strict'` only affects undeclared-variable access — never argument counts. Escalating "extra args ignored" to an Error is a category error (same class as finding 106).

## Fix

Keep UC2003 (extra-args) at Warning/Info regardless of strict mode — `'use strict'` does not make extra arguments an error in ucode.
