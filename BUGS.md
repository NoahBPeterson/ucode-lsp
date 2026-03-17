# uCode LSP Known Bugs

## ~~ Generic element-type inference (Array\<string\>) ~~ PARTIALLY FIXED in 0.6.9

`split()[n]` now returns `string | null`. `ARGV[0]` returns `string | null`. Remaining:
- `for (let opt in arr)` → element type instead of `unknown`
- `keys()` → `Array<string>`, `values()` → element type
- Array literals like `[1, 2, 3]` → `Array<integer>`

## ~~ isLikelyAssignmentTarget is token-based, not AST-based ~~ FIXED in 0.6.9

`isLikelyAssignmentTarget` in `hover.ts` scanned forward through tokens looking for `=`, but only stopped on a few specific token types (newline, semicolon, comma, etc.). It did not stop on `)`, `{`, or most other tokens. This meant that in `parse_array(val)` followed by `{`, the scanner would blow past the function signature, find an `=` much later in the file (e.g. `ret[TYPE_ARRAY] = parse_array`), and wrongly mark `val` as an assignment target. This caused `resolveVariableTypeForHover` to return `currentType` (from a later reassignment like `val = split(...)`) instead of `dataType` (`unknown`).

Introduced in 0.4.9. Fixed by inverting the logic: now only member-access tokens (`.`, `[`, `]`) continue the scan; everything else stops it. Should eventually be replaced with an AST-based check (is the node the `.left` of an `AssignmentExpressionNode`?).

## Inference on object properties

{} is just an object; what if you could inference all of its properties, too?

## Warn if "type(x)" is being compared to something that is not known to be a type

don't forget module types!

## ~~ ?? and && for type narrowing ~~ FIXED in 0.5.12

## chr(),ord(), range check the inputs :)

## 'this' and 'global' should have different types.

## if ("array" === type(unionValue) === "array")

equivalent to: ("array" === type(unionValue)) === "array"
    But always false! because left is a bool, and right is a string. Needs a warning diagnostic, but what?

## fs hover

const fs = require('fs');

let file = fs.open("data.txt", "r"); // fs.open's hover shows on 'fs' but not 'open'???
let content = file.read("data.txt"); // file.read()'s hover shows on 'file' but not 'read'???
print("len:", length(content));

##

NUD_REACHABLE, NUD_PERMANENT, IFA_F_PERMANENT are missing from rtnl constants:
  @ucode/lib/rtnl.c

  Cannot apply + to string ucode-semantic
  +readfile(`/sys/class/net/${ifname}/speed`), (yes you can; it converts to number or NaN)

## Scope:

if (this.vlan_id)
    name += "." + vlan_id; // Undefined variable: vlan_id ucode-semantic(UC1001)

---

## Bug 1: Handle template vs raw source code differences

Problem: Only template files can contain block comments with these tokens: `{#`, and `#}`. However, the LSP does not know when or how to handle this.
