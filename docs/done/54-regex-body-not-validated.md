# Invalid regex literal bodies are never validated → false negative

**Severity: low-medium (false negative).** ucode compiles regex literals at parse time and rejects malformed ones, but the LSP only scans for the closing `/` and flag characters — it never compiles the body, so malformed regexes pass review.

## Reproduction — rejected by ucode, no LSP diagnostic

```ucode
let re = /foo.*(/;       // ucode: "Syntax error: parentheses not balanced"
let re2 = /[z-a]/;        // ucode: "Syntax error: invalid character range"
```

Verified both reject in `/usr/local/bin/ucode`; the LSP reports nothing (only an unrelated unused-var warning).

## Root cause

`src/lexer/ucodeLexer.ts` `parseRegex` (≈ lines 483-542) tracks the char-class context and the closing delimiter + flags, but never compiles/validates the pattern. The `regexp(str, flags)` builtin has the same gap (its body is also unvalidated).

## Fix

Compile the regex body (e.g. with the JS `RegExp` engine, or a ucode-compatible check) and surface a diagnostic for unbalanced groups, invalid ranges, and dangling quantifiers — for both the `/…/` literal form and `regexp(...)`.
