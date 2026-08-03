# Parser-fidelity gaps vs. real ucode, round 3 — from tree-sitter-ucode v0.8.0 docs

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY.** One new issue this round: a false negative on
code that fails to compile on every ucode version ever shipped. Filed 2026-08-01, from
tree-sitter-ucode's documented-divergences audit (README + commit `0a7923d`).

> **Credit — REQUIRED IN EVERY COMMIT.** This issue was found and documented by
> **[`m00qek`](https://github.com/m00qek)** on GitHub while building
> [`tree-sitter-ucode`](https://github.com/m00qek/tree-sitter-ucode) (README "deliberate
> divergences" section, commit `0a7923d`). **Any commit that fixes, partially fixes, or
> touches this item MUST credit them**, e.g.:
>
> ```
> Reported-by: m00qek (https://github.com/m00qek)
> Co-authored-by: m00qek <m00qek@users.noreply.github.com>
> ```
>
> Rounds 1–2: `docs/done/m00qek-parser-fidelity.md`, `docs/done/m00qek-parser-fidelity-2.md`.

**Verification method (2026-08-01).** Every claim executed against THREE oracles: the old
local `/usr/local/bin/ucode`, a fresh build of vendored `ucode/` at `81205a2` (current
upstream master), and the `owrt-2512` reference container (the exact ucode pin
tree-sitter-ucode targets). All three agree on every case below.

---

## 1. `/` after a postfix `++`/`--` is lexed as a regex opener — we silently accept

**ucode**: `lexer.c`'s `no_regexp` flag ("the previous token yielded a value, so a following
`/` is division") is never set after emitting `TK_INC`/`TK_DEC`. A postfix increment therefore
leaves the lexer in expect-a-value state, and a following `/` starts scanning a **regex
literal**:

| source | all 3 oracles |
|---|---|
| `print(a++ / b)` | `Syntax error: Unterminated string` (regex scan runs off the line) |
| `print(a++ / b / 2)` | `/ b /` lexes as a regex literal → `Unexpected token, Expecting ')'` |
| `a++ /= b` | `Unterminated string` (also affected) |
| `print(a[0]++ / b)` | `Unterminated string` (any postfix target, not just plain names) |
| `print((a++) / b)` | **2** — parenthesized form is fine |
| `print(++a / b)` | **2** — prefix is fine (the `/` follows the operand label, which sets `no_regexp`) |

tree-sitter-ucode deliberately parses the ordinary division meaning instead of emulating the
bug (their call, documented in their README); for an LSP the right move is the opposite —
**warn**, because the code cannot run on any deployed or current-master ucode.

**LSP (current)**: zero diagnostics on `a++ / b` and `a++ / b / 2` (verified via CLI) — false
negative on guaranteed-broken code.

**Fix sketch**: in our lexer's regex-vs-division disambiguation, mirror ucode: when the token
immediately before a `/` (or `/=`) is postfix `TK_INC`/`TK_DEC`, real ucode scans a regex.
Rather than emulating the resulting garbage parse, emit a dedicated diagnostic (UC6020?):
*"ucode lexes '/' after a postfix `++`/`--` as the start of a regex literal ('Unterminated
string') — parenthesize the increment: `(a++) / b`"* anchored on the `/`, then recover by
lexing division so the rest of the file still analyzes. Quick fix: wrap the postfix expression
in parentheses (AST-based, per the quick-fix rule).

Note the lexer alone can't distinguish postfix from prefix `++` — but it doesn't need to: the
diagnostic condition is simply "`/` or `/=` directly follows a `++`/`--` token", which in the
prefix case (`++a / b`) never happens since the operand sits between.

**Version gating**: none — bug confirmed identical from the old binary through 25.12 to master
`81205a2`. If upstream ever fixes `no_regexp` after `TK_INC`/`TK_DEC`, gate the diagnostic
below the fix commit (division becomes real on newer targets).

---

## Audited, no action needed (for the record)

The rest of tree-sitter-ucode's v0.8.0 fidelity work was checked against our CLI the same day;
we already match real ucode on all of it: `\400` octal-escape rejection (UC6013), raw newlines
inside string literals (accepted), statement-position `{a: 1};` and unparenthesized arrow-body
`x => {a: 1}` (both rejected), `break`/`continue` outside loops, regex flags limited to
`g`/`i`/`s`, colon/`endif` alternative block syntax incl. the `else:`-takes-no-colon subtlety,
ASI dropping `;` only before `}`/EOF (not bare newlines), `export … from` rejection, `/*/` as
a complete empty comment (UC6017 — but see `docs/slash-star-slash-comment-change.md`: upstream
master has now CHANGED this), numeric object keys (UC6018), and empty import/export lists
(UC6019). Their template-mode findings (a `// … %}` comment swallowing the tag close;
unterminated `{%` tolerated at EOF; `{{ }}` empty-tag rejection) are recorded in
`docs/ucode-template-mode-support.md` — template mode is still unsupported end-to-end.
