# Spreading a variable (`...a`) is not counted as a use → false UC1006 "declared but never used"

**Severity: medium (false positive).** A variable whose only use is a spread (`...a`) — in an array literal, object literal, or call — is reported as `UC1006 "Variable 'a' is declared but never used"`.

## Reproduction

```ucode
let a = {x:1}; let b = {...a, y:2}; print(b.y);        // UC1006 on 'a'
let a = [1,2];  let b = [...a, 3];  print(b[0]);       // UC1006 on 'a'
function f(...r){return r;} let a=[1,2]; let b=f(...a); print(b);  // UC1006 on 'a'
```

All three run fine in `/usr/local/bin/ucode` (`2` / `1` / `[ 1, 2 ]`); `a` is plainly used.

## Root cause (confirmed in source)

`src/analysis/visitor.ts` — the `visit()` dispatch switch (≈ lines 64-185) has **no `case 'SpreadElement':` and no `default:` arm**. A `SpreadElement` node (an array element, object property, or call argument) is therefore silently dropped, so `visitSpreadElement` (`semanticAnalyzer.ts:2227`, which would visit `node.argument` and call `markUsed`) never runs. The variable inside the spread is never marked used.

The bug stays hidden whenever the variable is *also* referenced normally elsewhere (the other reference calls `markUsed`), which is why it only surfaces for spread-only variables.

## Fix

Add `case 'SpreadElement': this.visitSpreadElement(node as SpreadElementNode); break;` to the dispatch switch (and consider a `default:` arm that visits child nodes, to prevent the same class of silent drop for other node types).
