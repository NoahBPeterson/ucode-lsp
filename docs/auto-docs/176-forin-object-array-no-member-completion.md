# `for (let v in array<object>)` loop variable gets no member completion (object shape lost in arrays)

**Severity: low (completion).** Iterating an array of object literals types the loop variable as bare `object`, so member completion offers nothing for its known shape.

## Reproduction

```ucode
let arr = [ { x: 1 } ];
for (let v in arr) { v. }      // completion after `v.` → empty (should offer `x`)
```

Hover on `v` correctly shows `object`, so the element type is inferred — but it's bare `object`, not the literal shape `{x: integer}`. Verified: ucode for-in over an array iterates values (`for(let v in [{x:1},{x:2}]) print(v.x)` → `1\n2`).

## Root cause

Object-literal shapes are not preserved when they become array elements: `let arr = [{x:1}]` hovers `array<object>` (not `array<{x:integer}>`), and `arr[0].x` also fails to complete. Single root cause, two surfaces (index access and for-in). Shares the shape-loss root with finding 174.

## Fix

Preserve object-literal shapes as array element types (`array<{x:integer}>`), so for-in / index access can complete the element's members.
