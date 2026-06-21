# Template `'use strict'` demos

Hand-on demos for how `'use strict'` behaves in ucode **template** files, and how the
LSP (`detectStrictMode` + diagnostics) tracks it. Every claim below is verified against
the `ucode -T` oracle across **all five releases** (22.03, 23.05, 24.10, 25.12, main) —
results are identical in every version unless noted.

## The rule

A template honors `'use strict'` **only when the `{% 'use strict'; … %}` block is the very
first statement of the file.** Templates compile leading text / `{{ expr }}` / even leading
whitespace into an implicit `print(...)` statement, which pushes the directive out of first
position and silently makes it inert — the same "directive must be first" rule as raw ucode.
Comments (`{# … #}`) and a shebang emit no statement, so they don't displace it (but the
comment close must *abut* the block — see demo 02).

Under strict, reading an undeclared, non-injected variable is a hard `Reference error`.
Non-strict, that read is just `null`.

## Run a demo against the oracle

```sh
~/.local/bin/ucode25_12 -T demos/template-strict/01-strict-leading-block.uc
# strict files error on the undeclared read; non-strict files render with a blank.
ucode -T demos/template-strict/11-include-parent.uc   # run the PARENT, not the child
```

## Matrix (oracle-verified, all versions)

| Demo | Leading element | Runtime (`ucode -T`) | `detectStrictMode` |
|---|---|---|---|
| 01 strict-leading-block | `{%` block | Reference error | **strict** |
| 02 strict-after-comment | `{# … #}` abutting `{%` | Reference error | **strict** |
| 03 strict-trim-modifiers | `{%-` / `{%+` | Reference error | **strict** |
| 04 strict-shebang-utpl | `#!/usr/bin/utpl` + `{%` | Reference error | **strict** |
| 05 nonstrict-leading-text | literal text | renders, null read | non-strict |
| 06 nonstrict-leading-expr | `{{ 1 }}` | renders, null read | non-strict |
| 07 nonstrict-leading-whitespace | blank line / spaces | renders, null read | non-strict |
| 08 nonstrict-directive-not-first | `let …;` before directive | renders, null read | non-strict |
| 09 nonstrict-misspelled | `'use strcit'` | renders, null read | non-strict |
| 10 error-invalid-close | `+%}` (invalid close) | **Syntax error** | (see below) |
| 11/12 include parent + strict child | `{%` block | child errors on non-injected var | child **strict** |
| 13 error-nested-blocks | `{%` inside `{%` | **Syntax error** (nesting) | n/a |
| 14 error-unterminated-block | `{{` with no `}}` at EOF | **Syntax error** (unterminated) | n/a |

## Severity tracks strict mode

UC1001 (undefined variable) is emitted as an **Error under `'use strict'`** (a guaranteed
runtime `Reference error`) and a **Warning otherwise** (non-strict reads evaluate to `null`,
so it's a typo/render-scope heuristic, not a crash). So in the demos the free var is a red
Error in 01–04/12 and a yellow Warning in 05–09. It is still *flagged* in non-strict
standalone files — there's no in-workspace `include()` site proving the name is a render-scope
input. To see a free var fully suppressed, render it through an `include()` parent that
injects it (demos 11/12: `title` is clean, `subtitle` is flagged).

## `+%}` / `+}}` are rejected (no false negatives)

ucode rejects these invalid close tags as a syntax error (demo 10), and so does the LSP — the
lexer accepts `+` only as an *open* modifier (`{%+`/`{{+`), never on close. Accepting what
ucode rejects would be a false negative, which is never harmless.

## Nested blocks are rejected (no false negatives)

ucode forbids a `{%`/`{{` block inside another (demo 13: `Template blocks may not be nested`),
and so does the LSP. The match is greedy on adjacency, exactly like ucode: an abutting `{{`
nests (error), but `{ a: 1 }` and the space-separated `{ { } }` are ordinary object literals
(clean).

## Unterminated blocks are rejected (no false negatives)

An expression block `{{ … }}` or comment block `{# … #}` that hits EOF without its close is a
syntax error (demo 14: `Unterminated template block`), and the LSP now flags it. Matching
ucode's asymmetry exactly: a STATEMENT block `{% … %}` is *allowed* to run to EOF unterminated,
so that stays clean.

## Why demo 10 matters

`{%+ 'use strict'; +%}` is the exact shape that produced the earlier bogus "`{%+` defeats
strict" finding. `+%}` is an **invalid close in every version** (only `-` strips on close;
`+` is open-only), so that template was a *syntax error* — and a checker that only grepped
for the word "undeclared" misread its absence as "non-strict". With a valid close,
`{%+ 'use strict';` is **strict** (demo 03). A malformed template tells you nothing about
strict mode.
