# Regex validator: escaped `/` and `]`-in-class trip "Unbalanced parenthesis" FP

Status: **✅ IMPLEMENTED 0.7.88** — one-line root cause in `validateRegexBody`
(ucodeLexer.ts): the `\\` escape-skip ran before the class branch and never counted
the escaped char as a class MEMBER, so after `[^\/` the closing `]` was read as the
leading-literal-`]` form and the class swallowed the rest of the pattern (paren
count then off). Fix: `if (inClass) classLen++` on the escape path. Both glinet FPs
(ksmbd.uc:25, led.uc:22) gone from the corpus, nothing else changed; the genuinely
unbalanced true positives (`/(a/`, `/([^\]]/`) still flag, and `/a)/` stays unflagged
(glibc literal — oracle-verified). Note: the LITERAL scanner (parseRegex) was NOT
the culprit — its class walk was already escape-aware; only the validator's was
weaker. Tests in tests/syntax/test-lexer-number-regex-fixes.test.js (+9).

## The bug

Two perfectly balanced regexes get `UC6001: Unbalanced parenthesis in regular expression`:

```ucode
let m1 = match(p, /([^\/]+)$/);      // ksmbd.uc:25 — basename: chars after last slash
let m2 = match(d, /\[([^\]]+)\]/);   // led.uc:22  — text inside [brackets]
```

Both verified fine in real ucode (`c` and `hello` extracted). Minimal repro reproduces both
with our CLI at 0.7.77.

Likely root cause in the regex-body validator (the T54-era paren/range checks in the lexer):
the paren counter walks the body without properly handling (a) backslash escapes — `\/`, `\[`,
`\]` — and/or (b) bracket-class contents, where `(`/`)` are literals and the class ends only
at an unescaped `]` (with the leading-`]`-is-literal rule we implemented in 0.7.75). A `\]`
inside a class (`[^\]]`) probably terminates the class early, so the following `+)` is read
at top level and the count goes off; `\/` may be terminating the whole literal early.

Note the interaction with 0.7.74/0.7.75 (multi-line regex literals, leading-`]` literal): the
LITERAL scanner got these rules; the body VALIDATOR apparently has its own weaker walk. Unify
them — one escape-and-class-aware scan producing both the token span and the balance check.

## Ground truth (POSIX ERE via ucode's regcomp)

- Backslash escape makes the next char literal, inside and outside classes. (Strictly, POSIX
  leaves `\]` inside a class undefined — but ucode's regex-literal LEXER (lexer.c) processes
  the escape before regcomp ever sees it, so `[^\]]` reaches regcomp as `[^]]`, the
  first-position-literal `]` form. Follow the lexer, not libc.)
- Inside `[...]`, `(` `)` `|` `+` etc. are literals; the class ends at the first unescaped `]`
  that isn't in first (or first-after-`^`) position.

## Tests

`/([^\/]+)$/`, `/\[([^\]]+)\]/`, `/a\)b/` (escaped paren, no FP), `/[()]/` (parens as class
literals), `/(a(b)c)/` balanced-nested, and true positives still caught: `/(a/`, `/a)/`,
`/([^\]]/` (genuinely unbalanced).
