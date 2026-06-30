# Signature help disappears for an unclosed call at EOF with a trailing comma + whitespace

**Severity: low (feature gap).** Right at the moment the user finishes a comma and is about to type the next argument — when that comma is followed only by whitespace at end of file — signature help returns `null`.

## Reproduction

```ucode
function f(a, b) {}
f(1,
```
(cursor after the comma; trailing space + newline, nothing after) → `null`.

Other unclosed shapes work fine: `f(`, `f(1, 2` (no close), and `f(1,\nlet z=3;` all return the signature.

## Root cause

`src/signatureHelp.ts` `findEnclosingCall` (≈ lines 23-24) requires `offset <= node.end`. In this recovery shape the `CallExpression`'s `end` doesn't extend past the last comma through the trailing whitespace, so the cursor sits beyond `node.end` and no enclosing call matches.

## Fix

Extend the enclosing-call match to include trailing whitespace within an unterminated call (or clamp the cursor to the call's argument region), so signature help survives the exact "just typed a comma" state.
