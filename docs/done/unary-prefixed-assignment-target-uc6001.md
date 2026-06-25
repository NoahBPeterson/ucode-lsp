# `!lvalue = rhs` (assignment under a prefix unary op) → false UC6001 parse errors

Status: **FIXED** in 0.7.4 (found 2026-06-19, verified vs `/usr/local/bin/ucode` and the
per-release oracles). Niche but real — valid ucode in shipped OpenWrt source.
Corpus hit: `openwrt/package/network/services/hostapd/files/hostapd.uc:407`.

Fix: `parseUnary` (src/parser/expressions/operatorExpressions.ts) now absorbs a trailing
assignment into the unary's operand when (a) the operator is `! ~ + -` (NOT `++`/`--` —
ucode rejects `++a = b`), and (b) the operand is an lvalue (Identifier/MemberExpression —
ucode rejects `!(a+1) = b` and `!a() = 5`). All 15 assignment operators are absorbed
(`!a += b` runs as `!(a += b)`). Regression test:
`tests/syntax/test-unary-prefixed-assignment.test.js` (9 cases, accept + must-reject).

## Symptom

```js
let k = [1, 2, 3];
if (!k[2] = compute(k[2])) { … }     // hostapd.uc:407 (abridged)
```

The LSP emits **two** hard errors on this line:

```
UC6001: Invalid assignment target
UC6001: Unexpected token in expression
```

Both are **false positives** — the line is valid ucode.

## Verified semantics (runtime)

```
$ ucode -e "let k=[1,2,3]; if (!k[2] = 7) print('t'); else print('f k2='+k[2]);"
f k2=7
```

ucode parses `!k[2] = 7` as `!(k[2] = 7)`: the assignment to the member `k[2]` happens first
(precedence of assignment is *below* the prefix `!`, so the unary operator takes the whole
assignment as its operand), then the result is negated. The member `k[2]` becomes `7`, the
assignment value `7` is truthy, `!7` is false → the `else` branch runs. No syntax error.

This is the general rule: a prefix unary operator (`!`, `-`, `~`, `+`) applied to an
assignment expression wraps the assignment — `<unop> lvalue = rhs` ≡ `<unop>(lvalue = rhs)`.

## Root cause

The parser treats the operand of a prefix unary operator as a non-assignable expression: when
it then encounters the `=`, the already-parsed `!k[2]` is rejected as an "Invalid assignment
target" and the `=` is an "Unexpected token". The parser is binding `=` to `(!k[2])` (an
r-value) instead of letting the assignment be the operand of `!`. The unary-expression
production should descend into (or be re-associated with) an assignment expression so that
`<unop> <assignment>` parses, matching ucode's actual precedence.

## Notes / scope

- Distinct from the assignment-target FPs already fixed: `docs/auto-docs/
  151-ternary-alternate-assignment-rejected.md` (assignment in a ternary alternate) and
  `152-for-init-comma-rejected.md` (sequence in a `for`-init). This is the **prefix-unary**
  case, not covered by either.
- Real-world frequency is low (one corpus site), but because it produces two *hard errors*
  that also cascade (the rest of the `if` is mis-parsed), it poisons an otherwise-clean file.
- The idiom (`if (!x = f(x)) return;` — "assign, and bail if the result is falsy") is a
  terse but legitimate ucode pattern.
