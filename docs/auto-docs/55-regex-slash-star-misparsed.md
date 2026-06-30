# `/*/` is misparsed as a block-comment start → wrong "Unterminated comment" error

**Severity: low (wrong message / misclassification).** A regex literal beginning `/*` is lexed as a block comment instead of a regex, producing a misleading diagnostic and wrong token classification.

## Reproduction

```ucode
let re = /*/;            // LSP: "Unterminated comment"
```

ucode rejects `/*/` too, but for a different reason (`Syntax error: Expecting expression`) — the LSP's message and token classification are wrong: it never recognizes the regex context.

## Root cause

`src/lexer/ucodeLexer.ts` — on seeing `/` followed by `*`, the lexer unconditionally enters block-comment mode, without first deciding (from the preceding token) whether a regex is expected in this position. Here `/` follows `=`, where a regex literal is expected.

## Fix

When `/` appears in a regex-permitting position (after `=`, `(`, `,`, `return`, an operator, etc.), prefer regex tokenization over the `/*` comment interpretation, consistent with how the lexer already disambiguates regex-vs-division elsewhere.
