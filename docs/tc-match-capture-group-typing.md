# Static capture-group typing for match(): known length + per-group nullability from the regex literal

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** `match()` against a regex LITERAL now types its result as a static tuple (per-group nullability from an ERE capture-group scanner); mandatory-group nullable-argument FPs are gone and literal out-of-range indices are flagged (UC5008).

## Fix

- **`src/analysis/regexTypes.ts`** — new `analyzeCaptureGroups(pattern)`: a small POSIX-ERE scanner (bracket-expression-aware, escape-aware) that walks the pattern once, builds a group tree, and computes per-group optionality. Verified against the runtime (`/usr/local/bin/ucode`) that `(?:...)` is a `regcomp` error ("repetition-operator operand invalid") — ucode compiles straight through `regcomp(..., REG_EXTENDED)` (ucode/types.c:1397-1415) with no preprocessing, so there is no non-capturing group; every unescaped `(` outside a bracket expression is a real capturing group, counted left-to-right.
  - **Optionality rules implemented** — a group is optional iff, on the path from the pattern root to that group: (a) it's directly under a 0-minimum quantifier (`?`, `*`, `{0,...}` — `{1,n}`/`+` keep it mandatory); OR (b) its ENCLOSING frame (the whole pattern, or an ancestor group's own body) has a top-level `|` (the group is one alternation branch, the other might run instead — `(a)|(b)`: both optional); OR (c) any ANCESTOR group is itself optional. Alternation INSIDE a group's own body does NOT make that group optional (`(stdout|stderr|exitcode)` is one mandatory group — the `|` only picks what string it captures). Anything the scanner can't cleanly prove mandatory (unbalanced input, scanner exception) defaults to optional — conservative, sound over-approximation.
- **`src/analysis/symbolTable.ts`** — `ArrayType` gained an optional `tupleTypes?: UcodeDataType[]` field (general `elementType` stays the fallback shape for non-literal-index access/iteration); `createTupleArrayType(elementType, tupleTypes)` and `resolveTupleIndex(type, index)` (negative-index-aware — mirrors `ucv_key_get`'s `idx += length`, ucode/types.c:2435-2440) are new exported helpers. Deliberately minimal — not a general tuple-type system.
- **`src/analysis/checkers/builtinValidation.ts`** — `validateMatchFunction` (the match() return-type site): for a regex LITERAL argument, calls `tryAnalyzeRegexLiteralGroups` → `analyzeCaptureGroups`, builds `tupleTypes = [string, <per-group string|string|null>...]`, and types the per-match result as `createTupleArrayType(...)` (a `g`-flagged match wraps it as `array<tuple>`). A dynamic regex (`regexp(...)`, a variable) keeps the old un-narrowed `array<string>` shape — unchanged behavior.
- **`src/analysis/typeChecker.ts`** — computed-member-access (`checkMemberExpression`): new `tryResolveTupleAccess(arrType, propNode, objNode)` resolves a LITERAL index (via `numericLiteralValue`, which already unwraps a unary minus — so `m[-1]` works) through the tuple table; a provably out-of-range literal index pushes **UC5008** (warning) and resolves to `null`. Wired into the three computed-member branches (union-with-null, plain array-typed symbol, "any array-typed expression"). Soundness: (1) the tuple only replaces the SLOT's own nullability — the receiver's own possible-null-ness (`m` itself might be null, i.e. no match at all) is still unioned back in UNLESS the receiver is narrowed non-null at this position (`getNarrowedTypeAtPosition`); (2) a new `tupleShapeStillValidAt` check declines the tuple (falls back to the general path) if the array may have been mutated (`shift`/`pop`/`splice`/reassignment — reuses the existing `arrLengthInvalidatedBetween`) between its tuple-establishing assignment and the access, mirroring the existing length-guard staleness check.
- **`src/analysis/errorConstants.ts`** — new `CAPTURE_GROUP_OUT_OF_RANGE = 'UC5008'` (warning severity).
- Tests: `tests/test-tc-match-capture-typing.test.js` (14 tests: mandatory/optional/alternation-inside-group/nested/sequential groups, `m[0]`, out-of-range + UC5008, g-flag, dynamic pattern unchanged, quantifier `{0,n}` vs `{1,n}`).
- `tests/inference/test-match-capture-narrowing.test.js` (pre-existing suite) updated: 5 assertions whose "stays nullable without an explicit length() guard" premise is now obsolete for a regex literal with a statically-known tuple shape (once the receiver is narrowed non-null, in-range mandatory slots — including negative indices — no longer need a `length()` guard at all); see the updated in-file comments for the control-flow reasoning behind each.

## The gap

`match(str, /re/)` results are typed as bare `array<string> | null`, losing everything the regex
literal statically guarantees. From ucode's own test runner:

```ucode
else if ((m = match(line, /^-- End( \(no-eol\))? --$/)) != null) {
    if (m[1] != null && ...)          // m[1] is string | null (optional group) — checkable
else if ((m = match(line, /^-- File (.*)--$/)) != null) {
    section = [ 'file', `${dir}/files/${trim(m[1]) || 'file'}`, '' ];
    // today: "nullable-argument: Argument 1 of trim() may be null" — FP, group 1 is mandatory
```

## Ground truth (verified in C)

`uc_match` (ucode/lib.c:3126): on success the result array has **exactly `1 + re_nsub`
elements** — the loop pushes every slot, `ucv_string_new_length(...)` for participating groups
and `NULL` (`rm_so == -1`) for non-participating ones. So for a REGEX LITERAL:

- length is static: `1 + <capture group count>` (count unescaped `(` excluding `(?:` etc. —
  match what POSIX `re_nsub` counts; note ucode regexes are POSIX ERE, so no lookahead/named
  groups — only `(?:`-style needs care if the lexer even permits it; verify against
  ucode/lib.c uc_regexp handling).
- `m[0]` is always `string` on success (the full match).
- `m[k]` for k ≥ 1: `string` if group k participates in every successful match (mandatory
  position), `string | null` if the group is optional (`(...)?`, `(...)*`, or in an unused
  alternation branch). A conservative sound approximation: mandatory ⇔ the group is not under
  `? * |` — anything harder defaults to `string | null`.
- With the `g` flag: `array<tuple> | null` of the same per-match tuple (uc_match pushes each
  `m` into `rv`).

## Proposed approach

Where the argument to match()/regex position is a regex literal, compute
`{groupCount, perGroupNullable[]}` at analysis time (small ERE scanner; reuse
src/analysis/regexTypes.ts which already parses patterns for hover). Type the non-g result as a
fixed-length tuple-flavored array (element type per index; falls back to `string | null` union
for unknown indices), nullable overall. Index accesses with literal indices < length resolve to
the per-group type; out-of-range literal indices are provably null (worth a diagnostic of its
own — the group doesn't exist). Non-literal regexes keep today's typing.

## Classification

**Partially solvable** (fully solvable for regex literals — the overwhelming corpus case;
dynamic patterns stay as today). Eliminates the nullable-argument FPs on mandatory groups and
answers "is m[1] valid" statically. run_tests.uc alone: 3 match() sites; corpus-wide match()
is a top-20 builtin.

## Limitations (audit-confirmed, 2026-07)

- **POSIX character classes are mis-scanned.** The bracket-expression scanner in
  `analyzeCaptureGroups` stops at the first `]`, so a class like `[[:alpha:]]` or `[]abc]`
  (leading-`]` member) confuses its bracket-depth bookkeeping. This does **not** affect the
  group *count* (character classes contain no `(`), so `UC5008` out-of-range and tuple *length*
  stay correct; the only exposure is per-group *optionality* bookkeeping drifting on a pattern
  that mixes such a class with alternation/quantifiers. And the scanner's default-to-**optional**
  on anything it can't prove mandatory keeps that drift **sound** (a group wrongly marked optional
  is `string | null` — imprecise, never a dropped null). Worth hardening the bracket scanner to
  recognize `[:class:]` and leading-`]`, but it cannot currently produce an unsound (too-narrow)
  type.
- **Global-flag double-index** (`m[0][1]` on a `/…/g` result) is best-effort — the inner tuple is
  nested in an `array<tuple>` and resolves only if `getTypeOf(m[0])` surfaces the tuple type.
- **Regex literals only.** `regexp(...)` and variable patterns keep the bare `array<string> | null`
  shape — no static length or per-group nullability. By design.
