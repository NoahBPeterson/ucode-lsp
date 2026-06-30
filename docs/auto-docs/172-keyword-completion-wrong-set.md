# Keyword completion offers the bogus `throw` and omits most real ucode keywords

**Severity: low-medium (completion correctness).** The keyword completion list contains `throw` (not a ucode keyword) and is missing many real ones.

## Reproduction

General completion → keyword-kind items are exactly:
`let, const, function, if, else, for, while, return, break, continue, try, catch, throw`.

Verified against the interpreter: `throw "x"` → `Syntax error: Unexpected token` (ucode has **no** `throw`). Meanwhile `switch`, `case`, `default`, `import`, `export`, `delete`, `true`, `false`, `null`, `this`, `in` are all real ucode keywords (each compiles/runs) but **none** are offered.

## Root cause

A hardcoded list at `src/completion.ts:624` that contradicts the lexer's authoritative `Keywords` map (`src/lexer/tokenTypes.ts:133-163` — which has no `throw` and has all the others).

## Fix

Derive the keyword completion list from the lexer's `Keywords` map (the single source of truth), removing `throw` and adding `switch`/`case`/`default`/`import`/`export`/`delete`/`true`/`false`/`null`/`this`/`in`.
