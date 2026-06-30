# Two-level nested member access yields no hover / type

**Severity: low (hover/inference gap).** Hover on a depth-≥2 member access (`a.b.c`) returns null, even when the value is provably typed; one-level `a.b` works.

## Reproduction

```ucode
let a = { b: { c: 5 } };
let x = a.b.c;       // hover x → null (should be: integer)
```

Hover directly on `a.b.c` is also null. `a.b` correctly hovers `integer`... wait — one-level works. Verified: `type({b:{c:5}}.b.c)` → `int`. The nested-object machinery resolves shapes for *completion* but not for hover / type-resolution of a depth-≥2 member access.

## Root cause

`checkMemberExpression` (`typeChecker.ts`) doesn't resolve the type of a multi-hop member chain for hover (related to the nested-object-completion finding 19, but this is the hover/type-resolution face).

## Fix

Resolve the type of a multi-level member chain (descend nested property shapes) so hover and downstream inference work past the first hop. Note: this is masked in practice by the `}}` lexer bug (finding 01) for *compact* nested literals — but spaced literals (`{ b: { c: 5 } }`) reach the analyzer and still fail.
