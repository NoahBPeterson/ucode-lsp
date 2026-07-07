# Completion in a `let`/`const`/`for`-init variable-name position offers builtins (rename-on-commit hazard)

**Severity: low-medium (completion).** While typing a *new* variable name after `let`/`const`/`for (let`, completion offers the 91 builtins and keywords — so accepting a highlighted item (Tab/Enter) silently names your variable after a builtin.

## Reproduction

```ucode
let pri      // completion → print, printf, sprintf, length, …  (insertText "printf")
const        // same
for (let     // same
```

Expected: suppressed (empty), exactly like `function lo|` already returns `[]` via `isFunctionNameContext` (`completion.ts:290`). The user is inventing an identifier — offering `printf` invites a bad commit that renames the variable to a builtin.

## Root cause

`isFunctionNameContext` guards the `function NAME` position but there is no equivalent guard for `let`/`const`/`for`-init declarator name positions, so they fall through to the general completion list.

## Fix

Add a declarator-name-position guard (mirroring `isFunctionNameContext`) that returns `[]` when the cursor is on the name being declared in a `let`/`const`/`for`-init.
