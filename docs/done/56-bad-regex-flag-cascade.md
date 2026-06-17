> ✅ **FIXED 0.6.249** (C1 cluster). `parseRegex` now emits a valid `TK_REGEXP` for an unsupported flag (so the argument survives) and records the flag error in a new `lexer.errors` side-channel that server.ts/cli.ts merge into diagnostics — only the real flag error shows, no arg-count cascade. (Hovering a flag also now explains g/i/s.)

# An unsupported regex flag discards the regex token → cascading false arg-count errors

**Severity: low (cascade).** When a regex literal has an unsupported flag, the (correct) "Unsupported regex flag" diagnostic is accompanied by a spurious downstream argument-count error, because the regex argument vanishes from the AST.

## Reproduction

```ucode
printf("%s", /a/m);      // correct: "Unsupported regex flag 'm'"  + spurious UC2006 "1 specifier but 0 arguments"
match("a", /a/m);        // correct flag error + spurious "match expects at least 2 arguments, got 1"
```

## Root cause

`src/lexer/ucodeLexer.ts` `parseRegex` (≈ lines 504-512) returns a `TK_ERROR` mid-token on an unsupported flag and discards the whole regex literal. The dropped argument then disappears from the call's argument list, so arg-count checks (printf's UC2006, match's min-arity) see one fewer argument than the source has.

## Fix

On an unsupported flag, still emit a (placeholder) regex token/AST node so downstream argument-count logic sees the argument. Report only the flag error, not the phantom count error.
