# Parameter-forwarding return types (a tiny subset of call-site specialization)

Status: **planned, not built** (spec'd 2026-06-21). Motivated by fw4.uc `parse_enum(value, …)
{ … return value; }` and the general identity/passthrough pattern, where the return type
*is* one of the arguments. Today these return `unknown` (see `TRIAGE-2026-06-15.md`
auto-docs/169: "inferNodeType returns UNKNOWN for parameter Identifiers, so
parameter-dependent returns remain unknown").

## What this is — and what it deliberately is NOT

**Full call-site specialization (previously rejected, stays rejected):** at each call,
substitute concrete argument types into the parameters and **re-analyze the whole function
body** to derive the return type. Cost is O(calls × body size) plus recursion/cycle/caching
complexity. We are not doing this.

**This feature — parameter forwarding:** a function whose return is *literally* a parameter
gets a **symbolic** return signature (`return = param#N`) computed ONCE at its definition. At
each call site the return type is just the already-computed type of argument N — an O(1)
lookup, **no body re-analysis**. It is argument forwarding, not monomorphization.

The firewall against the rejected complexity is in what the classifier **refuses**: if a
return is anything other than a bare parameter (e.g. `return f(x)`, `return x + 1`), the
function is NOT classified and behaves exactly as today. No transitive/recursive re-analysis
can ever be triggered.

## Behavior (oracle-grounded)

ucode is dynamic, so an identity function genuinely forwards the runtime type (verified):
`passthru(5)` → int, `passthru("s")` → string, `passthru([1])` → array. The feature models
that statically for the cases below.

```
let o = {
    passthru: function(x) { return x; },               // signature: returns param#0
    pick:     function(a, b, c) { return cond ? b : c; } // signature: returns param#1 | param#2
};
let r1 = o.passthru(5);       // r1 => integer   (was unknown)
let r2 = o.passthru("s");     // r2 => string
let r3 = o.pick(1, "x", 2);   // r3 => string | integer
```

## Design

### 1. Detection (once, at definition — syntactic)

Classify a function's return as parameter-forwarding by inspecting its return expressions
(the same set `collectReturnTypesQuiet` in `semanticAnalyzer.ts` already walks; extend it to
also classify, or add a sibling `classifyParamForwardingReturn(fnNode, params)`):

- Resolve each `return <expr>` to a **parameter position** when `<expr>` is:
  - a bare parameter identifier (`return x` → that param's index), or
  - a ternary / `||` / `&&` whose operands all resolve to parameter positions
    (`return c ? a : b` → union of the positions), or
  - a parenthesized form of the above.
- The function is **parameter-forwarding** iff EVERY return path resolves to a parameter
  position (collect the set of positions). Expression-body arrows (`x => x`) count: the body
  is the single "return".
- Otherwise → not classified (unchanged behavior). Specifically NOT classified:
  - any return that is a call, member access, binary/arithmetic, literal, object/array, etc.
  - a mix of param and non-param returns (`return c ? x : 5`) → bail (simplest & safest;
    a later refinement could widen to `paramType | literalType`).
  - a rest/variadic parameter target → skip that function (can't index a spread by position).

Result: a symbolic marker, e.g. `returnForwardsParams?: number[]` (sorted, deduped param
indices) on the function/property signature.

### 2. Storage (the signature carries a symbol, not a concrete type)

Add to `SymbolEntry` (symbolTable.ts, next to `returnType` line 314 / `parameters` line 315):

```ts
returnForwardsParams?: number[]; // return type == union of these parameter positions' arg types (call-site resolved)
```

Populate it wherever a function's return type is currently recorded:
- named `function foo(){}` (the return-type stamping path, semanticAnalyzer ~1474/1516),
- function-valued `let f = …` (semanticAnalyzer ~888–894),
- object-literal methods → store in a parallel map alongside the new `propertyReturnTypes`
  (the 0.7.1 `propertyReturnTypes` / `inferObjectLiteralFunctionReturnTypes` machinery).

When `returnForwardsParams` is set, leave `returnType` as a coarse fallback (e.g. the union of
the params' *declared* types, or `unknown`) for contexts that don't do call-site resolution.

### 3. Application (at each call site — O(1))

At the return-type resolution sites, BEFORE falling back to the stored `returnType`, check the
callee's `returnForwardsParams`; if present, return the union of `type(arg[N])` for each N
(types we already compute when checking the call's arguments). Missing arg N → `null`/unknown
for that position.

Sites to touch (all already resolve call return types):
- `semanticAnalyzer.inferMethodReturnType` (member calls `obj.m()` / `this.m()` — the 0.7.1
  Case 0 branch is the natural home),
- `semanticAnalyzer.inferFunctionCallReturnType` (bare `foo()` and function-valued vars),
- `typeChecker.checkCallExpression` (the general checkNode path / hover).

Factor the substitution into one helper, `resolveForwardedReturn(sig, callNode)`, called from
each site so the logic isn't duplicated.

## Edge cases / scope

| Case | Result |
|---|---|
| `function(x){ return x; }` | param#0 forwarded |
| `x => x` (expr-body arrow) | param#0 forwarded |
| `function(a,b){ return c ? a : b; }` | param#0 ∪ param#1 |
| `function(x){ return x + 1; }` | NOT classified (arithmetic) → unchanged |
| `function(x){ return f(x); }` | NOT classified (call) → unchanged; **no recursion** |
| `function(c,x){ return c ? x : 5; }` | bail (mixed param/non-param) — or future: `T \| integer` |
| call with fewer args than N | param#N → `null`/unknown at that site |
| rest/variadic param target | function skipped |
| recursion `function f(x){ return f(x); }` | return is a call → not classified → safe |

## Phasing

1. **P1** — classifier (`classifyParamForwardingReturn`) + `returnForwardsParams` on
   `SymbolEntry`, populated for object-literal methods only (smallest surface; directly fixes
   the fw4 `parse_enum` case). Substitution in `inferMethodReturnType`.
2. **P2** — extend population to named functions and function-valued vars; substitution in
   `inferFunctionCallReturnType` + `checkCallExpression`.
3. **P3** (optional) — widen the "mixed param/non-param" bail to a real union
   (`paramType | otherType`).

## Tests

- identity `passthru(x)`: int/string/array/object args → matching return; arity-mismatch → null.
- ternary/`||`/`&&` of params → union.
- NOT classified: `return x+1`, `return f(x)`, `return {a:x}`, mixed `c?x:5` (bail) — all stay
  as today (regression guard).
- recursion `f(x){return f(x)}` → no hang, unknown.
- fw4 `parse_enum(value, choices){ return value }` called with a string arg → string.
- Oracle parity is N/A (types aren't observable at runtime), but `type()` on the result
  confirms the dynamic forwarding the model approximates.

## Risks / notes

- Keep classification strictly syntactic and local — the moment a return is a *call*, bail.
  That single rule is what keeps this from becoming the rejected full specialization.
- Unions can grow if many param positions are forwarded; dedupe and cap (e.g. ≤4 positions).
- The coarse `returnType` fallback must stay sound for non-call-site consumers (hover on the
  bare function, etc.) — union of declared param types, or `unknown`.

## Related
- `docs/done/function-valued-variable-return-type.md` — return-type stamping for `let f = …`.
- 0.7.1 object-literal method return types (`propertyReturnTypes`, `inferMethodReturnType`
  Case 0) — the substitution hooks live here.
- `TRIAGE-2026-06-15.md` auto-docs/169 — the recorded symptom this fixes.
