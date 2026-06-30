# Comma / sequence operator rejected in `if` / `while` / `do-while` conditions

> **STATUS: FIXED in 0.6.203.** The `if`/`while` conditions — and the `switch` discriminant —
> are now parsed at `Precedence.COMMA` (the same production as parenthesized expressions and
> `for`-init/update), so the sequence operator is accepted: `if (a=1, b=2)`,
> `while (a=next(), b=next())`, `switch (a, b)`. This also clears the cascading false UC6001
> ("continue/break outside loop") that a body emitted when its loop failed to parse.
> **Correction to this doc:** ucode has **no `do-while` loop** at all — there is no `do`
> reserved word (`ucode/lexer.c`), and `/usr/local/bin/ucode` rejects `do { … } while (…)`
> with "Syntax error: Unexpected token". So only `if`/`while`/`switch` were applicable.
> Tests: `tests/test-comma-operator-conditions.test.js` (15). Repro:
> `comma-operator-conditions-demo.uc`.

**Severity: medium.** The parser does not accept the comma (sequence) operator inside the parenthesized condition of `if`, `while`, and `do-while`. It produces `Expected ')' after <X> condition` + `Unexpected token in expression`, and — for a `while` body — a cascading false `UC6001 "Continue statement outside loop"` because the loop fails to parse.

## Reproduction

Real corpus: `packages/utils/prometheus-node-exporter-ucode/files/extra/netstat.uc`:

```ucode
while (names = nextline(f), values = nextline(f)) {
    ...
    if (name[0] != value[0])
        continue;          // false UC6001 "Continue statement outside loop"
    ...
}
```

Diagnostics produced: `Expected ')' after while condition`, `Unexpected token in expression`, and `Continue statement outside loop` for each `continue`/`break` in the body.

Confirmed it also fails for `if` and `do-while`:

```ucode
if (a = 1, b = 2) print('x');                 // "Expected ')' after if condition"
do { ... } while (a = 1, b = 2);              // "Expected ')' after while condition"
```

## Why it is wrong

ucode fully supports the comma operator (verified vs `/usr/local/bin/ucode`):

```ucode
let a, b, i = 0;
while (a = (i < 3 ? i : null), b = a, i++ < 5) { ... }   // runs fine
let x = (1, 2, 3); // x == 3
```

The comma operator already works **everywhere else** in the LSP — `let x = (1,2,3)`, `return (sideeffect(), 42)`, `for (let i=0,j=10; i<j; i++, j--)`, `f((a,b))` are all clean. Only the `if`/`while`/`do-while` condition parser is affected: it parses a single assignment-expression and then demands `)` instead of a full (comma-inclusive) expression.

## Fix

Parse the `if`/`while`/`do-while` condition with the same top-level expression production used for parenthesized expressions and `for`-init/`for`-condition (which both already accept comma).
