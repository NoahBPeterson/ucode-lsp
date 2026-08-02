# `from` is a contextual keyword — the parser must accept it as an ordinary identifier

Status: **IMPLEMENTED 0.7.80 (uncommitted, awaiting user test).** `from` removed from the
lexer keyword map (lexes as TK_LABEL; the dead TK_FROM enum member is kept for numbering
stability); import/export parsers use `matchContextualFrom()` (string-match + advance,
mirroring ucode's `uc_compiler_keyword_consume`); the four consume-then-check
`match(TK_LABEL) && previous().value === 'as'` sites were converted to peek-first (they
would otherwise swallow a following contextual `from` - one caused a real `export * from`
regression caught by the suite); hover/definition/completion `TK_FROM` consumers updated to
label checks. Verified: glinet vpn-client.uc drops from 33 `from`-cascade diagnostics to 0,
and rpc.uc's cross-file "module could not be parsed" is gone. Oracle-verified extras:
`import from from "./m.uc"` and `import * as from from "./m.uc"` are legal and now parse.
Tests: tests/syntax/test-from-contextual-keyword.test.js. Demo: zzzz/from-identifier-demo.uc.
Was: **NOT STARTED — 🔴 HIGH PRIORITY.** One parse failure cascades into ~33 diagnostics on
a real codebase (glinet-ucode), including a cross-file "module could not be parsed" on the
importer. Found 2026-08-01 via the glinet audit
([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md)).

## The bug

Our parser treats `from` as a reserved word everywhere. Real ucode reserves it only
CONTEXTUALLY — inside `import … from "x"` / `export … from` positions (and ucode has no
`export from` at all; see docs of UC-export-from). Everywhere else it's a plain label:

```ucode
let from = params.from ?? {};              // vpn-client.uc:397 — valid ucode
function match_from(from, mac, typ) { … }  // vpn-client.uc:825 — valid ucode
```

Verified: `/usr/local/bin/ucode -e 'let from = 1; print(from)'` works; the whole
`vpn-client.uc` compiles clean in real ucode. Our CLI (0.7.77):

```
error UC6001: Expected variable name          (let from = …)
error UC6001: Expected identifier             (function match_from(from, …))
+ cascade: "Unexpected token in expression", ~29 bogus UC1001 "Undefined variable:
  from/mac/typ", and the importer's "module could not be parsed"
```

## ucode ground truth

In ucode's lexer `from` is NOT a keyword token at all — `uc_tokennames`/keyword table has no
`from`; the import parser matches it as a plain `TK_LABEL` with string comparison
(`compiler.c` import parsing: `uc_compiler_keyword_check(…, "from")`-style). So identifier
positions never conflict. Our lexer/parser presumably tokenizes `from` as a keyword token
(TK_FROM?) unconditionally.

## Fix sketch

Whichever of these matches our implementation:
- If the lexer emits a dedicated `TK_FROM`: stop; emit `TK_LABEL` and have
  `parseImportDeclaration` match the label's string value (mirroring ucode).
- If the parser has `from` in a reserved-identifier list (`canUseAsIdentifier` /
  declaration-name checks): remove it there and match it contextually in the import parser.

Places to check: variable declarations, function names, params, object shorthand keys,
member access (`params.from` — likely already fine since member names are labels), for-in
targets, import SPECIFIER names (`import { from } from "x"`? — real ucode: verify; `from` as
an imported name plus the contextual `from` afterward is the parser's hard case — test it
against the oracle before deciding the error message).

## Tests

`let from`, `const from`, `function from() {}`, param `from`, `for (let from in x)`,
`params.from`, `{ from: 1 }`, `{ from }` shorthand — all clean; `import { x } from "m"` still
parses; `import { from } from "m"` matches oracle behavior (verify first); UC1001 cascade
gone (the vpn-client.uc shape as an e2e fixture).
