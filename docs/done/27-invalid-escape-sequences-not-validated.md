# Invalid string/template escape sequences are silently accepted — false negatives

**Severity: low-medium (false negative).** ucode validates escape sequences strictly and rejects malformed ones at compile time. The LSP's string/template/regex scanners have a catch-all `default` arm that accepts *any* escape, so every malformed escape passes review.

## Reproduction — all rejected by ucode, no LSP diagnostic

```ucode
let a = "\u41";      // ucode: Invalid escape — \u needs exactly 4 hex digits
let b = "\u{41}";    // ucode: Invalid escape — brace form unsupported in ucode
let c = "\x4";       // ucode: Invalid escape — \x needs exactly 2 hex digits
let d = "\xZZ";      // ucode: Invalid escape — non-hex after \x
let e = "\777";      // ucode: Invalid escape — octal escapes unsupported
```

`"A"` and `"\x41"` are correctly accepted by both, so the well-formed cases are fine — only the malformed ones are missed.

## Root cause

`src/lexer/ucodeLexer.ts` — `parseString()` escape switch (≈ line 429), the template-literal escape switch (≈ line 466), and the regex escape handling all end in `default: value += escaped` (or equivalent), accepting unknown/malformed escapes silently.

## Fix

Validate the `\u` (exactly 4 hex), `\x` (exactly 2 hex), and numeric escapes against ucode's grammar, and emit a diagnostic for malformed forms (including `\u{…}` and octal `\NNN`, which ucode does not support).
