# Surrogate-pair (emoji/astral) characters produce a broken `�` in the error message and a split range

**Severity: low (message + range).** When an astral-plane character (e.g. an emoji) appears in an unexpected-character position, the lexer reads only one UTF-16 unit, so the diagnostic message interpolates a lone surrogate (rendered `�`) and the range covers only half the codepoint.

## Reproduction

```ucode
😀;              // LSP: "Unexpected character: �" with a zero-width/off-by-one range
😀 undefz;       // same broken message; the downstream real error (undefz) is correctly placed
```

(ucode also rejects an emoji here, so *flagging* is correct — only the message text and range are wrong.)

## Root cause

`src/lexer/ucodeLexer.ts` `peekChar`/`nextChar` (≈ lines 712-719) index `this.source[idx]` per **UTF-16 unit**, splitting astral codepoints. The message uses one half; combined with finding 80 the range is also wrong.

## Fix

Use `codePointAt` to read the full codepoint for the message, advance by the codepoint's UTF-16 length (2 for surrogate pairs), and span the range over both units.
