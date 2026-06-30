# Hover on a number/string/bool/null literal returns nothing

**Severity: low (hover gap/inconsistency).** Free-standing scalar literals have no hover, while a regex literal and an object-literal *property value* both do — so the behaviour is inconsistent.

## Reproduction

```ucode
let x = 42;        // hover 42      → null
let y = 'hi';      // hover 'hi'    → null
let z = true;      // hover true/false/null/3.14 → null
```

Expected (editor convention): `(integer) 42`, `(string)`, `(boolean) true`, etc.

## Inconsistency

An object-literal property value *does* get a literal hover — `{ name: 'x' }` → "**(string)** String literal", `{ v: 5 }` → "**(number)** Number literal" (via `formatPropertyValueHover`) — and a regex literal `/ab+/g` hovers richly. Only free-standing number/string/bool/null literals have no hover path.

## Fix

Add a hover path for scalar literals (number/string/boolean/null) showing the type (and value where useful), reusing the existing `formatPropertyValueHover` logic so it's consistent with object-property-value hovers.
