# "Expected ';' after return value" — false positive before `}`

Status: **DONE (0.6.188)** — implemented the fix below + tests
(test-return-semicolon-before-brace.test.js). Verified vs `/usr/local/bin/ucode`. Date: 2026-06-08.
First seen: `packages/utils/uvol/files/lvm.uc:110-111`.

## Verdict

`return <expr>` with **no semicolon, immediately before `}`** is **valid ucode** — the LSP's
UC6004 "Expected ';' after return value" here is a **false positive**. It is independent of
`'use strict'`, and there is **no** case (this form or otherwise) where a missing semicolon
produces a *runtime* error.

```js
function f(dms) {
    return split(dms, '/')[-1]   // ← no ';'
}                                // ← next token is '}'  →  ucode accepts it
```

## The ucode rule (verified, general)

A statement's terminating `;` is **optional when the next token is `}`** (block close), but
**required between two statements**. This is general — not return-specific:

| code | ucode result |
|---|---|
| `return expr` ⏎ `}` | **OK** (prints `c`) |
| `let x = 5` ⏎ `}` | OK |
| `o.a = 9` ⏎ `}` | OK |
| `print("hi")` ⏎ `}` | OK |
| `return 1` ⏎ `print(...)` | **Syntax error** "Expecting ';'" (two statements, no separator) |
| `let x = 5` ⏎ `return x` | **Syntax error** "Expecting ';'" |

`'use strict'` changes nothing — verified byte-identical with and without the pragma (both
print `c`). It only affects runtime undeclared-variable behavior, not grammar.

## Can a missing `;` after a return value cause a runtime error? No — categorically.

1. A missing semicolon is a **parse/compile** concern. ucode compiles the entire program
   before executing it, so a genuine missing-`;` problem is a **compile-time syntax error** —
   the program never starts. It can never surface at *runtime* (runtime errors are
   undeclared-variable access, type errors, thrown exceptions — none affected by `;`).
2. For the specific form flagged (`return expr` before `}`), it isn't even a compile error —
   ucode accepts it. So it yields neither a compile nor a runtime error.
3. The only form that *is* a real ucode error — `return expr` followed by another statement —
   is caught at compile time, before execution.

So the diagnostic is purely a parser strictness mismatch with zero runtime consequence.

## Root cause

The LSP already elides `;` before `}` for general statements (the `let`/assignment/expr cases
above produce no diagnostic). `return` is the **lone offender**: `parseReturnStatement`
(controlFlowStatements.ts:231-247) hardcodes an unconditional consume:

```ts
let argument = null;
if (!this.check(TokenType.TK_SCOL) && !this.isAtEnd()) {
    argument = this.parseExpression();
}
this.consume(TokenType.TK_SCOL, "Expected ';' after return value");   // ← fails when next is '}'
```

## Fix

Make the terminator optional before `}` (and EOF), mirroring the general statement-terminator
logic — and don't parse an expression when the next token is `}` (the bare `return }` case):

```ts
let argument = null;
if (!this.check(TokenType.TK_SCOL) && !this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
    argument = this.parseExpression();
}
if (this.check(TokenType.TK_RBRACE) || this.isAtEnd()) {
    this.match(TokenType.TK_SCOL);                       // optional ; before block close / EOF
} else {
    this.consume(TokenType.TK_SCOL, "Expected ';' after return value");  // still required between statements
}
```

This keeps the *true* error (`return 1` then `print(...)` → still flags the missing separator)
while removing the false positive on `return expr` before `}`. Add a regression test:
`return expr` before `}` → clean; `return expr` then another statement → still UC6004.

### Note

The "true error" case (`return X` followed by a statement) is, semantically, *two statements
without a separator* — arguably better reported on the following statement than as "after
return value." Out of scope here; the immediate fix is removing the before-`}` false positive.
