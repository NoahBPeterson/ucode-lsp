# `sort` comparator's **second** parameter is typed `unknown` (should be the element type)

**Severity: low (inference gap).** In a `sort(arr, (x, y) => …)` comparator, the first parameter gets the array's element type but the second stays `unknown`, even though both receive elements.

## Reproduction

```ucode
let a = [1, 2];
let b = sort(a, (x, y) => x - y);     // hover x: integer ✓   hover y: unknown ✗ (should be integer)
```

Verified: `sort([3,1,2], (x,y)=>{ print(type(x), type(y)); ... })` prints `int int` for every call — both params are elements.

## Root cause

`semanticAnalyzer.ts:1644` applies the callback element type only to param 0:

```ts
const paramType = (i === 0 && this.callbackElementType) ? this.callbackElementType : UNKNOWN;
```

`sort` is the only builtin whose callback takes **two** element-typed params, so it's the sole victim. (`map`/`filter` callbacks are `(value, index, array)` — only param 0 is the element, so they're correctly typed; their index/array params staying `unknown` is fine.)

## Fix

For `sort`, apply `callbackElementType` to both param 0 and param 1.
