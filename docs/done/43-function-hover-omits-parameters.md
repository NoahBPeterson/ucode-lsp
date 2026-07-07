# Hover on a user function omits the parameter list

**Severity: low-medium (hover content).** Hovering a user-defined function name shows only `(function) name: \`function\`` with no signature — the parameters are not displayed, even though the analyzer already tracks them.

## Reproduction

```ucode
function add(a, b) { return a + b; }
add(1, 2);
```

Hover on `add` → `(function) **add**: \`function\`\n\nReturns: \`unknown\``. No `(a, b)`.

## Root cause

`src/hover.ts:1041-1048` renders the function symbol without its parameter list. The analyzer tracks `ParamInfo` per function (it's used by signature-help), so the data is available but not surfaced in hover. This makes user-function hover markedly worse than imported-builtin hover, which shows full parameter docs.

## Fix

Render the parameter list (e.g. `add(a, b)`) in the function hover, reusing the `ParamInfo` that signature-help already consumes.
