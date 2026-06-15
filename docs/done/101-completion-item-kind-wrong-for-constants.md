> ✅ **FIXED 0.6.248.** `NaN`, `Infinity`, `REQUIRE_SEARCH_PATH` now complete as `CompletionItemKind.Constant` (kind 21) with `detail: "constant"`, so editors render the constant icon. Mapped by name in the completion builder (`AMBIENT_CONSTANT_NAMES`) — deliberately **display-only**, NOT via `symbol.isConstant`, which would have made `NaN = 5` a UC1010 const-reassignment error (an unverified semantic change beyond this cosmetic fix). `ARGV` correctly stays a Variable. Tests: `test-completion-kind-and-detail.test.js`.

# `NaN` / `Infinity` / `REQUIRE_SEARCH_PATH` have the wrong CompletionItemKind

**Severity: low (completion polish).** These ambient constants are offered as `kind: 6` (Variable) with `detail: "variable"`, instead of `kind: 21` (Constant).

## Reproduction

Any general completion; inspect the `NaN` item → `{ kind: 6, detail: "variable" }`. Expected `kind: 21` (Constant), so editors render the constant icon.

## Root cause

In `src/analysis/symbolTable.ts` (~476-510) `NaN`, `Infinity`, and `REQUIRE_SEARCH_PATH` are declared as `SymbolType.VARIABLE`. `NaN`/`Infinity` are numeric constants and `REQUIRE_SEARCH_PATH` is a constant. (`ARGV` and `global`/`modules` as Variable is defensible.)

## Fix

Declare these as constants (or map them to `CompletionItemKind.Constant` in the completion builder).
