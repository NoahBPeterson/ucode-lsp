# Flag the CALL SITE whose arguments provably trip a warned deref

Status: **NOT STARTED - feature request from the 0.7.85 soundness review.**

## The ask

```ucode
function f1(c) {
    let v;
    if (c) v = { a: 1 };
    return v.a;          // UC5006 fires HERE (v: object | null)
}
print(f1(1), "\n");      // fine
print(f1(0), "\n");      // CRASHES - and the user expects a diagnostic HERE too
```

Today the may-null warning anchors at the deref site inside f1 - correct, but the
user reading the CALL line sees nothing, even though `c = 0` (falsy) provably takes
the unwritten path and crashes. "The LSP warns somewhere else in a function I have
to open" is materially worse UX than "this call crashes".

## Shape of the feature (interprocedural, per-callsite)

For a call with CONSTANT arguments to a same-file function that contains a
UC5005/UC5006-warned deref, re-evaluate the guard conditions with the constant
bound: if the branch protecting the deref is provably not taken (`if (c)` with
c = 0), escalate at the call site: "calling f1 with c = 0 leaves `v` null - the
`v.a` at line N will crash". Constant-propagation only (literal args), same-file
only, single level deep - no general interprocedural analysis. The existing
narrowing machinery (truthiness edges, NEVER_TYPE) can evaluate the branch once
the param is bound to a literal.

False-positive guardrails: only escalate when the deref is UNGUARDED on the
not-taken path (the flow engine already computes this per-branch); bail on any
non-literal argument; bail if the function has JSDoc-annotated params (trusted).

## Notes

- Related: callsiteParamInference was ripped out (fbefec0) for blast radius - this
  is narrower (diagnostic escalation only, no type changes).
- The demo shape lives in zzzz/soundness-campaign-demo.uc (f1).
