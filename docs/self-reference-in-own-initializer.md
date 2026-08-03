# Self-reference from inside a let/const's own initializer crashes on EVERY ucode

Status: **✅ IMPLEMENTED 0.7.87** — UC1012, unconditional Error (all-versions compile
crash). Purely syntactic scan (`findSelfRef`) with function-granularity shadowing
(param / funcexpr's own name / any inner re-declaration skips the whole function —
a block-scoped inner shadow beside an outer reference is a rare accepted FN);
for-init declarators EXEMPT (`for (let i = i; ...)` compiles and runs, oracle-verified
both binaries — so is self-WRITE `f = 1` an error, and builtin-named `let print =
print;`). One diagnostic per declarator. No quick fix yet (candidate: rewrite
`let f = function(){...}` → `function f(){...}`). Suite:
tests/diagnostics/test-self-reference-initializer.test.js (17).
Found 2026-08-01 while building the named-funcexpr gate
(docs/named-funcexpr-let-const-crash.md probe matrix).

## The bug we miss

```ucode
let f = function (n) { return n < 2 ? 1 : n * f(n - 1); };
print(f(5));
```

Real ucode - old binary AND master `81205a2` - rejects this at compile time:
`Syntax error: Can't access lexical declaration 'f' before initialization`. The function
body compiles DURING the initializer, when `f` is declared-but-uninitialized, and ucode's
compiler checks lexical initialization state at the reference site regardless of the fact
that the closure only runs later. Anonymous self-recursion through the declaring variable
is simply impossible in ucode, on every version.

Our CLI (0.7.79): **"No errors found"** - false negative on guaranteed-broken code.

## Boundary (oracle-verified 2026-08-01)

- `let a = function(){ return b(); }; let b = ...` (cross-variable, declared AFTER) -
  crashes at runtime on all versions; we DO already flag this (UC1009 family + warning).
- `let handler; let runner = function(){ return handler(); }; handler = ...;`
  (declared BEFORE, assigned later) - valid; we correctly stay silent (0.7.47 filter).
- So the 0.7.47 deferred-execution suppression is scoped right for CROSS-variable refs;
  the gap is exactly SELF-reference: an Identifier naming the variable being declared,
  anywhere inside its own initializer (function bodies included).
- On targets >= main, the supported way to self-recurse in an expression is a NAMED
  funcexpr (`let f = function fact(n){ ... fact(n-1) ... }`) - which is exactly what the
  named-funcexpr gate (shipped 0.7.79) points users toward on old targets vs new.

## Fix sketch

In `visitVariableDeclarator`: scan the initializer subtree for `Identifier` nodes with
the declarator's name (the `identifierAppearsIn` helper from 0.7.79 is 90% of it - but
here shadowing DOES matter: a nested function param or local named `f` legitimately
shadows; bail or resolve scopes before flagging, or restrict to references not under a
re-declaration of the name). Diagnostic: NOT version-gated - an unconditional error
("`f` cannot be referenced inside its own initializer - ucode rejects this on every
version: 'Can't access lexical declaration'"), with remedies: function declaration, or
(target >= main only) a named function expression.

## Tests

The anon-rec shape (error on all targets), cross-variable declared-after (existing
diagnostics unchanged), declared-before-assigned-later (stays clean), shadowed inner
`f` (param/local named `f` inside the initializer's function - clean), member access
`f.x` inside own initializer (also crashes? verify with oracle first), and the NAMED
funcexpr recursion form on target main (clean).
