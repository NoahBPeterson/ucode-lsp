> ✅ **FIXED 0.6.246** (coding half already fixed in 0.6.245 / #103). Argument-validation diagnostics now use one consistent shape:
> - **Canonical `, got`** everywhere (the 5 type-mismatch sites that read `but got` — `validateArgumentType` ×2, `match` regex hint, `exists` ×2 — now match the count family's `, got`).
> - **Proper pluralization**: the literal `argument(s)` / `specifier(s)` are gone — `expects at least 1 argument` vs `2 arguments`, `2 specifiers but only 1 argument`.
> - **Unified too-many shape**: the user-fn outlier `takes N arguments but M were provided; the extra … ignored` → `Function 'X' expects at most N argument(s), got M (extra arguments are ignored)`, matching the builtin `expects at most …, got …`.
> - **Codes on every variant** (from #103): definitely-wrong-type → `UC2004`, count → `UC2003`, nullable → `nullable-argument`, unknown → `incompatible-function-argument`.
> - The nullable (`Argument N of X() may be null`) and unknown (`… is unknown`) messages are deliberately left distinct — they describe a *possibly*-wrong / unknown value, not a definitely-wrong type; forcing them into `expects T, got C` would misstate the problem.
> - Tests updated (utility-functions-ast, conversion-functions, printf-spread, user-function-args, cross-file-args); demo `demo-107-arg-validation-wording.uc`.

# Argument-validation diagnostics are inconsistent — three wordings, mixed codes, and the *most-severe* case is the only un-coded one

**Severity: low (consistency).** One logical check ("is this argument the right type?") emits three different shapes, and the coding is backwards.

## The inconsistency

Within `validateArgumentType` (`builtinValidation.ts`), for argument 1 of `substr`:

| situation | message | code | severity |
|---|---|---|---|
| **definitely wrong type** | `Function 'substr' expects string … for argument 1, but got integer` | **none** | always **Error** (line 368) |
| maybe null | `Argument 1 of substr() may be null. Use a type guard…` | `nullable-argument` | strict-gated (281) |
| unknown | `Argument 1 of substr() is unknown. Use a type guard…` | `incompatible-function-argument` | strict-gated (327) |

So the **least** certain problems carry codes, while the **definitely wrong** one carries none — backwards. The wording also diverges: `Function 'X' expects T for argument N, but got C` vs `Argument N of X() is/may-be …`.

Separately, the same concept is emitted by `typeChecker.ts:2059` as `Function 'X' expects T for argument N, got C` — i.e. **"but got" vs ", got"** for the identical error class (≈8 ", got" sites vs 5 "but got" sites).

Argument-*count* has the same problem: `f(1,2,3)` (user fn, too many) → `UC2003` Warning `takes 1 argument but 3 were provided`; `substr("x")` (builtin, too few) → no code, Error, `expects at least 2 argument(s), got 1` — three phrasings, mixed codes/severities, and the awkward literal `argument(s)` pluralization.

## Fix

Unify the argument-validation diagnostics: one message template, consistent `, got` vs `but got`, proper pluralization, and a code on every variant (the definitely-wrong-type case especially must carry one).
