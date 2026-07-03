# Parser-fidelity gaps vs. real ucode — reported by m00qek

> **Credit — REQUIRED IN EVERY COMMIT.** All six issues below were found by
> **[`m00qek`](https://github.com/m00qek)** on GitHub while building
> [`tree-sitter-ucode`](https://github.com/m00qek/tree-sitter-ucode).
> **Any commit that fixes, partially fixes, or touches any item in this
> document MUST credit them**, e.g. with a commit-message trailer:
>
> ```
> Reported-by: m00qek (https://github.com/m00qek)
> ```
>
> This applies per-issue: six separate fix commits ⇒ six credits. Do not fold
> a fix into an unrelated commit without the trailer.

All ucode-side behavior below is verified against the vendored `ucode/` C
source (current main), not just a local binary. Common theme: these are
**JS-isms our parser deliberately supports but ucode rejects at compile
time** — so the LSP stays silent on code that cannot even compile.

---

## 1. Invalid `\u` escape sequences accepted silently

```ucode
printf(`\uXXXX only; no \u{1234} allowed`); // LSP: no diagnostics on \u{1234}
```

**ucode**: `parse_escape` (`ucode/lexer.c:227`) requires **exactly 4 hex
digits** after `\u` → `\u1234` is valid; the ES6 `\u{1234}` form does not
exist (`{` fails `isxdigit` → *"Invalid escape sequence"*, then the leftover
`1234}` garbles the rest of the string, producing the second *"Unexpected
character"* error). Same strictness applies to `\x` (exactly 2 hex digits)
and octal escapes (max `\377`; >255 errors). Unpaired surrogate halves are
**not** errors (replaced with U+FFFD / combined when paired).

**LSP**: `src/lexer/ucodeLexer.ts:520-529` and `:554-566` — the escape
`switch` has `default: value += escaped;` — *any* unknown escape is passed
through with no validation, in both string kinds and template literals.

**Fix sketch**: validate in the lexer where the escape is consumed (exact
offsets are still known there): `\u` not followed by 4 hex digits, `\x` not
followed by 2, octal >255 → error diagnostic anchored on the escape.

## 2. `delete` on a non-member expression / unknown property

```ucode
let object = {'a': [1,2,3,4,5]};
delete object.b; // legal but a provable no-op → should warn (closed shape)
delete object;   // LSP silent — but a compile-time SYNTAX ERROR in ucode
```

**ucode**: `uc_compiler_compile_delete` (`ucode/compiler.c:1224`) requires the
operand to compile to a property access (`I_LVAL`), else *"expecting a
property access expression"* — **unconditionally, in both strict and
non-strict**, since the operator form landed (`ff6811f`, 2021-05); the
strict-only gate applied to the legacy `delete(obj, key)` **call** form,
removed entirely in `03b6a8e` (2022-01). Every target version we support
(22.03+) post-dates both, so `delete object` is always a syntax error.
(Older firmware binaries — e.g. GL.iNet sft1200 — still have the legacy call
path, which is where the "exception only under strict" observation comes
from.)

**LSP**: the parser accepts any unary operand and
`visitDeleteExpression` (`src/analysis/semanticAnalyzer.ts:3744`) validates
only member-property flow — a bare-identifier operand sails through.

**Fix sketch**: (a) error when the `delete` argument is not a
MemberExpression (parser or analyzer); (b) separate *warning* for
`delete obj.b` when `obj` has a `closedPropertyShape` without `b` — runtime
no-op returning false, almost certainly a typo.

## 3. Array elision (`[1,,2]`) accepted

```ucode
let array_ellision = [1,,2]; // ucode: "Expecting expression" — always fails
```

**ucode**: no elision support — the array literal parser demands an
expression after every comma.

**LSP**: `parseArray` (`src/parser/expressions/compositeExpressions.ts:22-23`)
*deliberately* supports elision: `if (this.check(TK_COMMA)) elements.push(null)`
— a JS-ism.

**Fix sketch**: emit "ucode does not allow array holes; expected expression"
anchored on the comma (keep pushing `null` for recovery so downstream indices
stay aligned).

## 4. Parameters after `...rest` — cascade instead of one clear error

```ucode
function test(a,b,c,...rest,f) {} // LSP: tons of diagnostics
```

**ucode**: after a rest param the compiler leaves the param loop and expects
`)` (`ucode/compiler.c:1993-2003`) → single *"Expecting ')'"* error.

**LSP**: `src/parser/statements/declarationStatements.ts:121-130` parses the
rest param, then the stray `,f` derails the parser into a diagnostic cascade.

**Fix sketch**: on `,` after a rest param, emit exactly one diagnostic —
"`...rest` must be the final parameter" — then consume params up to `)` for
recovery (parse-and-discard so the body still analyzes).

## 5. `for (const … in …)` accepted

```ucode
for (const a in object['a']) { print(a); } // ucode: syntax error, both modes
```

**ucode**: `uc_compiler_compile_for` (`ucode/compiler.c:2812`) matches only
`TK_LOCAL` (`let`); `const` falls through to the expression path →
*"Expecting expression"*. Applies to C-style `for (const i = 0; …)` too.

**LSP**: `src/parser/statements/controlFlowStatements.ts:216,221,261`
explicitly accepts `TK_CONST` in both for forms.

**Fix sketch**: keep parsing it (treat as `let` for scope/type recovery) but
emit "ucode does not allow 'const' in a for loop; use 'let'" on the `const`
keyword.

## 6. Labelled `break` / `continue` accepted

```ucode
for (let a in object['a']) {
    continue d; // ucode: "Expecting ';'" — no labels exist in ucode
    break d;    // same
}
```

**ucode**: `uc_compiler_compile_control` (`ucode/compiler.c:3098`) takes no
label operand; the statement must end at `;`.

**LSP**: `parseBreakStatement` / `parseContinueStatement`
(`src/parser/statements/controlFlowStatements.ts:328-330,345-348`) explicitly
parse an optional label — pure JS-ism; the AST even carries a `label` field
nothing validates.

**Fix sketch**: still consume the label for recovery, but emit "ucode does
not support labelled break/continue" anchored on the label. (Optionally drop
`label` from the AST nodes once nothing produces it.)

---

Status:
- 1 (`\u` escapes): **open**
- 2 (`delete` non-member): **open**
- 3 (array elision): **fixed in 0.7.40** — UC6008, `tests/syntax/test-array-elision.test.js`
- 4 (params after rest): **open**
- 5 (`for (const …)`): **open**
- 6 (labelled break/continue): **open**
