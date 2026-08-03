# `/*/` is no longer a complete empty block comment in latest ucode

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (bumped from LOW 2026-08-01: OpenWrt main's ucode
pin is now `b885dd0`, 2026-07-09, which CONTAINS `9c5f16c` — so anyone targeting `main` already
runs the new comment semantics and our old-style lexing + UC6017 wording is wrong for them).
Found 2026-08-01 reviewing upstream `3ec4e5c..81205a2`.

## TL;DR

Upstream `9c5f16c` ("lexer: do not treat /*/ as a complete block comment", 2026-07-04) changed
`parse_comment` to consume the second opening char **before** the terminator loop, so the opening
`*` can no longer double as the closing `*`:

- **Old (all current pins, and what our lexer deliberately mirrors):** `/*/` is a complete empty
  comment. `let star = /*/ 1; let ignored = /**/ 2;` → `star == 1`.
- **New (master ≥ `9c5f16c`):** `/*/` merely *opens* a comment, which runs to the **next** `*/`.
  The same line comments out ` 1; let ignored = /*` and yields `star == 2` (verified with the
  built `81205a2` binary). A `/*/` with no later `*/` is an unterminated comment.

## Where we model the old behavior

`src/lexer/ucodeLexer.ts` `parseBlockComment` (~line 913): explicit special case
`if (this.peekChar() === '/')` → empty comment + **UC6017** warning ("'/*/' is a complete EMPTY
comment in ucode, not a regex matching '*' …") + a quick fix in server.ts that escapes the star.
Verified via CLI: our analysis binds `star = 1` and sees `ignored` as a separate declaration
(old semantics).

## What to do (when a pin catches up)

Version-gate the lexer's empty-comment special case on the target version:

- Below the fix: keep today's behavior (empty comment + UC6017 warning + quick fix).
- At/above the fix: treat `/*/` as a comment **opener**; the comment ends at the next `*/`.
  UC6017's message is then wrong — replace with a warning along the lines of "'/*/' opens a
  block comment (it is NOT an empty comment on {target}); everything until the next '*/' is
  ignored", keeping the escape-the-star quick fix (the construct is still almost always an
  attempted regex for '*').

Note the lexer currently has no version plumbed in; the version-feature machinery
(`flagVersionFeature`) lives in the parser/analyzer. Either thread the target version into the
lexer, or (cheaper) keep lexing old-style and let the analyzer re-flag — but that cannot
reproduce the new token stream (the comment swallows real code), so proper support needs the
version in the lexer. That plumbing is also needed by
[sign-after-exponent-number-lexing.md](sign-after-exponent-number-lexing.md) — do them together.

## Evidence

- new binary: `let x = /*/ 1; print("hi"); /**/ 2; print(x);` → prints `2` only (the `print("hi")`
  was inside the comment).
- our CLI on the same shape: UC6017 fires, `star = 1`, `ignored` declared (old semantics).
