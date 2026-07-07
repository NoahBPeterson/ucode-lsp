# Unary `+`/`-`/`++`/`--`/`~` collapse any union operand to `unknown` instead of distributing

Status: **NOT STARTED.** Filed 2026-07-07 from the `--type-coverage` audit.

## The gap

Binary arithmetic (`+ - * / %`) already distributes over union operands member-by-member
(`arithmeticTypeInference.distribute`, `src/analysis/arithmeticTypeInference.ts:47`), so
`(integer | string) + 1` soundly yields `integer | string` instead of guessing. **Unary**
`+`/`-`/`++`/`--`/`~` do not: any operand that isn't a *plain* `UcodeType.STRING` or a plain
non-union base type falls through to a blanket `unknown`, even when every member of the union
has a perfectly well-defined coercion.

Minimal repro (`/private/tmp/.../probes/unaryplus2.uc`, also representative of the real
`firewall4/root/usr/share/ucode/fw4.uc:1212-1224` capture-group idiom below):

```ucode
function f(param) {
    let x = param ? 5 : null;   // x : integer | null
    let neg = -x;                // shows `unknown` — should be `integer`
    let plus = +x;                // shows `unknown` — should be `integer`
    let notted = ~x;              // shows `unknown` — should be `integer`
}
```

`null` coerces to `0` in every one of these operators (verified rule already encoded in
`getUnaryResultType`), and `integer` obviously stays `integer` — so **every member** of
`integer | null` has a defined, identical result (`integer`). The union should collapse to
`integer`, not to `unknown`.

Real corpus instance (`firewall4/root/usr/share/ucode/fw4.uc:1206-1224`, also
`openwrt-firewall4-with-fullcone/root/usr/share/ucode/fw4.uc`, ~78 corpus-wide sites match the
`= +expr` numeric-coercion idiom alone, undercounting unary `-`/`~` and non-assignment uses):

```ucode
let m = port ? match(port.val, /^([0-9]{1,5})([-:]([0-9]{1,5}))?$/i) : null;
if (!m) return null;
if (m[3]) {
    let min_port = +m[1];   // m[1] : string | null (per match() capture-group nullability,
    let max_port = +m[3];   // docs/reference_match_semantics.md) → both show `unknown`;
                              // real result is `integer | double` (string→number) ∪ `integer`
                              // (null→0) = `integer | double`
```

Confirmed via the standalone hover probe (`bun run dumphover.ts`, same technique as
`auditTypeCoverage`'s `handleHover` path) — `cap: string | null` then `let n = +cap;` shows
`n: unknown`.

## Root cause

`checkUnaryExpression` (`src/analysis/typeChecker.ts:1067`):

```ts
if (node.operator === '+' || node.operator === '-' || node.operator === '++' || node.operator === '--') {
  this.checkNaNArithmetic(...);
  if (argType === UcodeType.STRING) {                       // ← only a PURE string base matches
    return this.coerceStringForArithmetic(node.argument, argType);
  }
}
return this.typeCompatibility.getUnaryResultType(this.dataTypeToUcodeType(argType), node.operator);
```

`this.dataTypeToUcodeType` is `dataTypeToBase` (`src/analysis/symbolTable.ts:207`), which — by
documented, intentional design (`"Unions collapse to UNKNOWN (no single base)"`) — collapses
**any** union to `UNKNOWN` before `getUnaryResultType` ever sees it
(`src/analysis/checkers/typeCompatibility.ts:26-44`). So a union operand never reaches the
per-member coercion logic; it's discarded to `unknown` regardless of what its members actually
are. The `argType === UcodeType.STRING` special case is the *only* place a non-trivial operand
is handled richly, and it requires an exact `===` match, which a union never satisfies (rich
results are never `===` a bare `UcodeType`, per the `dataTypeToBase` docblock's own warning).

This is the same shape of bug as the (already-fixed) binary-operator case: before
`arithmeticTypeInference.distribute` existed, binary `+`/`-`/`*`/`/`/`%` had the identical
"union → single collapsed base → guess" flaw. Unary operators were never given the equivalent
treatment.

## Proposed approach

Add a `distribute`-style helper for unary operators, mirroring
`arithmeticTypeInference.distribute` (`src/analysis/arithmeticTypeInference.ts:47`): for each
member of the operand union (`getUnionTypes(argType)`), compute the per-member result using the
existing per-type rules (the `argType === STRING` coercion branch's logic, generalized, plus
`getUnaryResultType` for everything else), then `createUnionType(...)` the collected results
(dedup via `createUnionType`'s existing collapse-to-single-member behavior). Concretely:

```ts
if (['+', '-', '++', '--'].includes(node.operator)) {
  this.checkNaNArithmetic(...);
  const results = getUnionTypes(argType).map(member => {
    const base = singleTypeToBase(member);
    if (base === UcodeType.STRING) return this.coerceStringForArithmetic(node.argument, member); // may itself be a union (int|double)
    return this.typeCompatibility.getUnaryResultType(base, node.operator);
  });
  return createUnionType(results.flatMap(r => getUnionTypes(r)));
}
```

`~` can reuse the same distribute wrapper (its only special case, "unknown stays unknown", falls
out naturally — every concrete member yields `integer`, only a genuine `UNKNOWN` member should
survive as `unknown` in the output union). Reuse `getUnionTypes`/`singleTypeToBase`/
`createUnionType`, already imported in `typeChecker.ts` for the binary-operator path — no new
type-model surface needed. This is a strict quality improvement: every existing pure-type case
(`argType` not a union) collapses to the same answer as today, since `getUnionTypes` on a
non-union returns `[type]`.

## Classification

**Solvable.** Small, self-contained fix (new helper + one call-site change), reuses infrastructure
that already exists for the binary-operator case (`arithmeticTypeInference.distribute`,
`getUnionTypes`, `createUnionType`). No new type-model concepts.

**Occurrence estimate:** ~78 corpus-wide sites match the `= +expr` coercion idiom alone
(undercounts unary `-`, `~`, and unary `+`/`-` used outside a `let x = …` init — e.g. inside a
comparison or another expression), each producing at least one `unknown`-typed declaration plus
however many downstream reads inherit it. This is the direct root cause of a meaningful slice of
the `decl-from-expr`/`assign-target`/`other-read` populations in the type-coverage audit —
independent of the four upstream root causes (unannotated params, user-function return
inference, builtin/module returns, dict/member value typing): the *input* union here
(`string | null` from a `match()` capture group, `integer | null` from a ternary) is often
already fully and soundly known; the checker throws that knowledge away at the unary-operator
step itself.
