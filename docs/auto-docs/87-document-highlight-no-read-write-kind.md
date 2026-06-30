# Document highlight marks every occurrence as `Text` — no read/write distinction

**Severity: low (feature quality).** Highlighting a symbol returns the correct set of occurrences, but every one is `DocumentHighlightKind.Text`, so editors can't color writes differently from reads.

## Reproduction

```ucode
let v = 1;
v = 2;
print(v);
```

Highlight on `v` → 3 ranges, all `kind: 1` (Text). The declaration and the assignment `v = 2` should be `Write`; the read in `print(v)` should be `Read`.

## Root cause

`src/server.ts` onDocumentHighlight (≈ line 1481) hardcodes `DocumentHighlightKind.Text` for every occurrence.

## Note

The occurrence *set* is correct and scope-aware (it covers reads + writes + declaration and excludes same-name shadows in other scopes). Only the `kind` is missing.

## Fix

Tag the declaration and assignment-target occurrences as `DocumentHighlightKind.Write` and read occurrences as `Read`.
