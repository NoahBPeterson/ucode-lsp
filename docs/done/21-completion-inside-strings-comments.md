# Completion fires inside string literals and comments

**Severity: low-medium (completion).** A `.` (or manual completion) inside a string literal or a comment offers the global builtin list, instead of suppressing completion.

## Reproduction

```ucode
let x = 'hello.world';     // cursor right after the '.' inside the string → 91 builtins offered
let y = 1; // a.b          // cursor after '.' in the line comment → 91 builtins offered
/* obj.                    // cursor after '.' in the block comment → 90 builtins offered
```

In all three the LSP returns the full builtin completion list; it should return nothing.

## Why it matters

Typing prose, file paths, format strings, or URLs inside string/comment text constantly contains `.`, and each one pops an irrelevant completion menu (and the first item may auto-insert on Enter). Standard LSP behaviour is to suppress completion inside string and comment tokens.

## Fix

Before computing completions, check whether the cursor falls inside a string-literal or comment token (the lexer already produces comment tokens via the side-channel `comments[]`, and string tokens are in the token stream) and return an empty list when it does.
