# math transcendental functions (`pow`/`sqrt`/`sin`/`cos`/`exp`/`log`/`atan2`) return `double` but are typed `integer`

**Severity: low-medium (wrong inference, broad).** These math functions always return a `double` in ucode, but the LSP types their results `integer`.

## Reproduction

```ucode
import * as math from 'math';
let x = math.pow(2, 3);     // hover x: integer  (should be: double)
let y = math.sqrt(4);        // hover y: integer  (should be: double)
```

Verified: `type(math.sqrt(4))` → `double`; C `uc_pow`/`uc_sqrt`/etc. all `return ucv_double_new(...)`.

## Root cause

`mathTypes.ts` declares these with `returnType: "number"`, and `typeChecker.ts:1569` maps `case 'number': return UcodeType.INTEGER`. The functions declared `returnType:"double"` (acos/asin/atan/tan/cosh/...) render correctly — so the always-double transcendentals (atan2, cos, exp, log, sin, sqrt, pow; hypot already double) just need `"number"` → `"double"`.

## Note

`rand()` → int is fine; `abs`/`floor`/`ceil`/`round`/`trunc` are genuinely int-or-double (per input / per `output_type` arg), so `"number"` is defensible there. Only the seven transcendentals are unambiguously `double`.

## Fix

Change `pow`/`sqrt`/`sin`/`cos`/`exp`/`log`/`atan2` from `returnType: "number"` to `"double"` in `mathTypes.ts`.
