# Flow-typing gap: bare-`let` reassigned to a union-returning call

Status: **FIXED 2026-06-23 (two parts).**

1. **Reassignment consistency.** `visitAssignmentExpression` now mirrors the declarator's
   `inferFsType` / `inferImportedFsFunctionReturnType` resolution, so `let b; b = open(...)`
   flows the handle type (and `d = readlink(...)` → `string | null`), matching direct init.

2. **Object-handle nullability (the deeper bug this surfaced).** `inferFsType` used to collapse
   `open`'s declared `"fs.file | null"` to a bare non-null `fs.file` (via `getFsReturnObjectType`,
   which extracts only the `FsObjectType` enum). That dropped null on EVERY object-handle fs
   factory (`open`/`popen`/`mkstemp`/`fdopen`/`opendir`/…) on BOTH the declaration and
   reassignment paths — a silent false negative: an unguarded `open(path).read()` went unflagged.
   `inferFsType` now returns the full data type and preserves `| null` when the signature's
   return string includes `null` and `nullMeansWrongType` is not set (new `fsReturnIsNullable`
   helper in `fsModuleTypes.ts`). So `open()` → `fs.file | null`, unguarded member access flags
   UC5006, and a truthiness guard / `?.` clears it. This aligns the fs builtin path with the io
   module path, which already returned `io.handle | null`.

Regression coverage: `tests/modules/test-fs-flow-reassignment.test.js`.

Found 2026-06-22 while burning down quarantined tests (the scratch scripts
`test-hover-fs-types.js` / `test-final-comprehensive.js` were probing exactly this).

## Symptom (BEFORE the fix)

A variable read back as `unknown` instead of the assigned value's type when it was
reassigned to a CALL that returns an fs object / union type:

```ucode
let a = open("/x");          // a : fs.file            ✅ direct init worked
let b; b = 5;                // b : integer            ✅ literal reassignment worked
let b; b = [1,2];            // b : array<integer>     ✅
let b; b = open("/x");       // b : unknown → fs.file        (FIXED)
let b = 0; b = open("/x");   // b : unknown → fs.file        (FIXED)
let c; try { c = open("/x"); } catch (e) {}  // c : unknown → fs.file  (FIXED)
import { readlink } from "fs"; let d; d = readlink("/x"); // → string | null (FIXED)
```

So the gap is narrow and specific: **reassignment (not initialization) of a bare `let`
to a call whose return type is a union** drops the type. Plain-literal reassignment and
direct initialization from the same call both work, and most-recent-wins across literal
reassignments works.

## Why it matters

`open()` (and other fs/uci/builtin handles) return `T | null`. Code that does
`let fh; fh = open(...)` — common in try/catch or conditional-open patterns — gets no
type, so downstream member access and nullability checks on `fh` are not analyzed. This
is a false-negative class (missing diagnostics), which we treat as worse than a false
positive.

## Root cause (confirmed)

The `VariableDeclarator` init path (`processInitializerTypeInference`) resolves bare builtin
fs functions (`open`/`popen`/`mkstemp`/…) via `inferFsType` and imported fs functions via
`inferImportedFsFunctionReturnType` — both *before* falling back to `typeChecker.checkNode`,
because the type checker's builtins don't model those fs return types and report them as
`UNKNOWN`. The `AssignmentExpression` (reassignment / SSA most-recent) path ran only
`inferMethodReturnType` / `inferFunctionCallReturnType` / `checkNode`, never the two fs
resolvers, so a reassignment RHS of `open(...)` fell through to `checkNode`'s `UNKNOWN`.

## Fix

In `visitAssignmentExpression`, before the existing fallback chain, call `inferFsType` and
(when that misses) `inferImportedFsFunctionReturnType`, and prefer their results — the exact
priority order the declarator path uses. Bare `open()` → `fs.file`; imported `readlink()` →
`string | null` (union preserved). Narrow and sound: `inferFsType` only fires for the fs
builtins as identifier calls or `fs.method()` when `fs` is the genuinely-imported module.

## Coverage

`tests/modules/test-fs-flow-reassignment.test.js` pins the working cases plus the now-fixed
reassignment cases (open → `fs.file`; init-then-reassign; inside `try{}`; imported `readlink`
→ `string | null`; and most-recent-wins when a literal reassign follows an `open()` reassign).
