# Flow-typing gap: bare-`let` reassigned to a union-returning call

Status: **known limitation, characterized by a test, not yet fixed.**
Found 2026-06-22 while burning down quarantined tests (the scratch scripts
`test-hover-fs-types.js` / `test-final-comprehensive.js` were probing exactly this).

## Symptom

A variable reads back as `unknown` instead of the assigned value's type when it is
reassigned to a CALL that returns a union/nullable type:

```ucode
let a = open("/x");          // a : fs.file            ✅ direct init works
let b; b = 5;                // b : integer            ✅ literal reassignment works
let b; b = [1,2];            // b : array<integer>     ✅
let b; b = open("/x");       // b : unknown            ❌ should be fs.file | null
let b = 0; b = open("/x");   // b : unknown            ❌
let c; try { c = open("/x"); } catch (e) {}  // c : unknown  ❌
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

## Likely cause (not yet confirmed)

The `VariableDeclarator` init path infers a builtin call's return type and stores it; the
`AssignmentExpression` (reassignment / SSA most-recent) path applies literal/simple-type
inference but does not run the same call-return inference for union-typed returns, so the
narrowed `currentType` ends up `unknown`. A fix likely lives where the assignment path
computes the RHS type (mirror the declarator's call-return-type resolution, preserving the
union).

## Coverage

`tests/test-fs-flow-reassignment.test.js` pins both the working cases and the three
limitation cases (asserting the current `unknown`). When the gap is fixed, flip those
three assertions to `fs.file | null`.
