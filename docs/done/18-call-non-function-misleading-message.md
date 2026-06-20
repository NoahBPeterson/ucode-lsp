# Calling a defined-but-non-function variable reports "Undefined function" (wrong message)

**Severity: low (message clarity).** Calling a variable that holds a non-callable value (integer, string, array, …) correctly produces a diagnostic, but the message is `Undefined function: X` — which is false, because `X` *is* defined. It is just not callable.

## Reproduction

```ucode
let n = 5;     n();      // "Undefined function: n"   (n is an integer, not undefined)
let str = 'x'; str();    // "Undefined function: str"
let arr = [1]; arr();    // "Undefined function: arr"
```

ucode's real error is `Type error: left-hand side is not a function`. (A literal `1()` is correctly reported as `Cannot call integer as function` — so the right wording already exists for literals; only the *variable* path uses the misleading "Undefined function".)

## Why it matters

"Undefined function" sends the developer hunting for a missing import or a typo, when the actual problem is that the symbol holds the wrong *type*. The LSP already knows `n` is an integer (hover shows it), so the message should say so, e.g. `'n' is not a function (it is an integer)`.

## Fix

In the call-target validation, distinguish "identifier resolves to no symbol" (→ `Undefined function`) from "identifier resolves to a symbol whose type is not callable" (→ `'X' is not a function (it is a <type>)`).
