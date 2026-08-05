# Type-soundness audit: where `unknown`/`null` is incorrectly reduced away

Status: **PHASES 1-4 IMPLEMENTED 0.7.85 (uncommitted, awaiting user test).** Shipped:
moreNarrowed join-on-incomparable (canonical-equal filter kept - it protects sound
legacy guard narrowing); one-liners N-5 (cache key \0), N-4 (unknown whitelist x2),
N-2 (match de-listed + string-contract test updated), H-4 (pop/shift | null), I-2
(typeChecker 4406, analyzer 7345, hover raw fallback -> effectiveSymbolType); I-1
identifier branch context (TypeHistoryEntry gains start/branches/inLoop/elseType;
effectiveSymbolType is now the propertyTypeAt-style walk: definite writes replace,
conditional writes union, sibling if-branch writes excluded, in-loop writes ALWAYS
union - branch reasoning is invalid across back edges); I-4 branchStack pushed for
ternary arms (siblings), switch cases / &&,||,?? RHS / try+catch (may-run, no sibling
exclusion), and FUNCTION BODIES (a body write is may-run for outside reads - fixes
the live UC2015 FP); identifier `if (type(x) != "T") x = <T>` elseType (the quick-fix
normalization idiom stays definite); H-1 implicit-null returns (widenReturnForFallthrough
via blockAlwaysTerminates at all three inference sites).
Tests: tests/diagnostics/test-type-soundness-campaign.test.js (16). Contract updates
(user-visible, review): test-array-element-types #8 (conditional split write now unions
the fall-through arm), test-global-object-property-tracking (in-function global.X.prop
writes are may-run unions), test-string-contract-narrowing (match no longer narrows).
Corpus 57 files: 274->273 errors. Removed: 10 upgrade.uc UC5005 hard FPs (the
user-defined-guard shape - honest return unions cured them), 2 rewordings. Added: 9
strict-gated "may be null/unknown" argument errors on newly-honest union types (the
existing 'use strict' contract doing its stated job - vpn-client popen/ord/split,
cable length/substr/push, diag+tethering match-as-guard, upgrade index). Whether
strict mode should bail on compatible-member+unknown unions like UC2009 does is a
product decision - NOT changed this cycle.
Perf: 7.5k-line file 0.43s -> 0.48s (walk cost; still ~2.4x faster than pre-index).
USER-REVIEW ROUND (same version): (a) function-body writes are CALL-POSITION GATED -
impossible for reads before the fn's first reference (usedAt), and PROMOTED to
definite after an UNCONDITIONAL direct call (Symbol.definiteCallAt, stamped when the
call site has no enclosing branch/loop/body frame) when the write is unconditional
within the body: `function reset(){cfg.mode="off";} reset(); cfg.mode` is definite
string; before any call it is the pristine integer. (b) Broken-`//`-comment cascade
killed three ways: statement-position regexes are LINE-BOUNDED (a bare multi-line
regex statement is always the typo; expression positions keep multi-line, per user
rule), TK_REGEXP now sets noRegexp (a regex is a VALUE - division follows; also
added ===/!== to the regex-allowed list, a latent gap), and the parser emits ONE
root-cause hint with same-line echoes suppressed (user's 25-error file -> 2).
Binding-path note: declarator inference for member reads still uses the flat map
(test-global-object-property-tracking reverted to original expectations, documented
in-file) - unifying it with propertyTypeAt is part of H-3/H-5.
0.7.86 IMPLEMENTED H-2 + H-3 (container reads carry | null):
- H-3: dict value-shape reads `m[k]` and the `let v = m[k]` binding are now
  `object | null` (typeChecker dict branch + semanticAnalyzer binding site).
  EXEMPTION: a key with keys-of provenance for that very map
  (`for (let k in m) m[k]`, keysOfSymbol) proves presence -> stays definite.
  Without it: 6 FPs in glinet parental-control.uc; with it: corpus byte-identical.
  The bucket `??=` gate still runs first (dominated reads stay definite array).
- H-2: computeFunctionReturnInfo no longer hard-codes OBJECT — non-object-literal
  returns are collected (extraReturnTypes), a conservative blockAlwaysReturns
  (fileResolver-local mirror of blockAlwaysTerminates, no neverReturns lookup)
  adds the implicit fall-through null, and the final returnType is the union.
  Sub-bug fixed BOTH places: the return-branch property merge now intersects
  KEYS but unions TYPES (fileResolver + the in-file twin in
  visitFunctionDeclaration) — `{v:1}` / `{v:"s"}` reads back integer | string.
- hover.ts minimal-member fallback extended to `object | null` receivers so a
  dropped-by-intersection member still hovers `unknown` instead of nothing.
- Suite: tests/diagnostics/test-container-read-null.test.js (13; oracle-verified
  crash shapes + keys-of/bucket/guard/total-factory controls).
0.7.90 IMPLEMENTED N-1 + N-3 (coercing comparisons are not type guards; full
oracle matrix in tests/diagnostics/test-coercing-comparison-guards.test.js,
identical on both binaries):
- N-1: loose ==/!= var-var narrowing now requires EVERY member of the other
  side's type to be reference-exact (array/object/function/regex/null —
  `==` on references is pointer identity, [1]==[1] is false; null only
  loose-equals null). Scalars coerce (0=="0", ""==false, "1"==true, 1==1.0)
  so a scalar match proves nothing. ===/!== unchanged (same-type-only;
  1===1.0 is FALSE). Gate lives in extractVariableEqualityGuard (isStrict
  param); the `== null` check was verified sound and untouched.
- N-3 (polished per user review): numeric comparisons narrow to the exact SOUND
  passable set instead of the unsound integer|double. From unknown, a true
  `x <op> K` proves `integer | double | string` (numeric strings coerce:
  "10">5, "5.5">5, "-3"<0 all TRUE) + boolean iff 0-or-1 passes K (true>5 is
  FALSE → bools drop for `> 5`; false<5 TRUE → they stay for `< 5`) + null iff
  0 passes K (null behaves exactly as 0). References NEVER pass. Known unions
  refine per-member with the same predicate; an unknown MEMBER tightens to the
  passable set. Literal-on-left mirrors the operator.
- Contract updates (documented in-file): hover-type-narrowing 61-63 (no
  fabrication), filter-narrowing-matrix 28 (`x > 5` predicate no longer types
  elements), equality-narrowing-hover scalar cases switched to strict
  operators (same machinery, sound trigger), 19b likewise.
- Corpus: +1 vetted honest strict error (tailscale.uc:170 — `pos >= 0` does
  not exclude null from index()'s integer|null; null>=0 is TRUE). Same
  strict-mode-on-honest-types family as 0.7.85's 9.
REMAINING (phases 5-6, not started): N-6 engine assignment transfer, N-7 NEVER
laundering, H-5 index history, H-6 literal unknown elements, H-7 cross-file
builtin shims, I-5 global binder gate, I-6/I-7 misc writers, loop contract
decision.
Original audit below. Requested after the
0.7.81 (identifier) and 0.7.84 (member) fixes: "where else do we incorrectly reduce
`unknown` from the type?" Three parallel code audits (identifier SSA, narrowing/joins,
inference helpers) + an empirical probe battery. Line numbers = HEAD e1157a4.

## The disease, in one sentence

A value whose honest type is `T | unknown` or `T | null` gets a DEFINITE `T`, which
(a) suppresses the null-safety warnings that exist for exactly those crashes (false
negatives - LSP silent, runtime "left-hand side expression is null"), and (b) feeds
impossible-comparison/coercion lints a type claim they act on (false positives).

Mitigating structure discovered while probing: `x == null` comparisons are EXEMPT from
UC2009 (typeChecker.ts ~2031, owned by the null-safety layer), so most null-deletion
bugs surface as FALSE NEGATIVES + wrong hover, not hard errors. The FP surface is
UC2015 coercion, UC5003/UC5005, UC2004, and non-null UC2009 comparisons.

## EMPIRICALLY CONFIRMED (probe battery, oracle-verified crashes)

Every "runtime" below is /usr/local/bin/ucode output.

1. **Conditional identifier write -> definite post-if type.**
   `let v; if (c) v = {a:1}; return v.a;` - LSP CLEAN, runtime CRASH (f(0)).
   Hover: `array<integer>` definite for the `if (c) v = [1]` variant. Same for an
   unannotated param (`x = [1]` under if -> definite, honest `array | unknown`).
2. **Post-loop read of a loop-body write.** `let acc; for (x in list) acc = {n:x};
   return acc.n;` - LSP CLEAN, runtime CRASH (f([])). Identifier twin of the shipped
   rv.days member contract - the FN cost of that contract, now measured.
3. **Conditional return / fall-off-the-end.** `function f(c) { if (c) return 1; }` -
   ucode returns null on fall-through; we claim return type `integer` definite.
   `f(0).a` LSP CLEAN, runtime CRASH. `let r = f(0)` hovers `integer`.
4. **Reassignment inside a guard keeps the guard's narrowing.**
   `if (x != null) { x = g(x); return x.a; }` with g returning `object | null` -
   hover `object` definite, LSP CLEAN, runtime CRASH. (Documented literal-null-only
   invalidation, typeChecker.ts ~5580; the flow engine computes the honest answer and
   it is discarded - see AMPLIFIER below.)
5. **Function-body member write claims definite for later positioned reads.**
   `let cfg = {mode: 0}; function reset() { cfg.mode = "off"; }
   if (cfg.mode == 0) ...` - **UC2015 FP fires today** ("string vs 0 coerces"),
   runtime prints "default". The body write replaces the declared member type with no
   branch context, even if the function is never called.
6. **Conditional `global.X = {...}` -> definite `object`** for all later reads
   (probe I1; partially flagged by UC8004/8005 for other reasons).

Confirmed SOUND by probes: callsite param inference does not exist anymore (ripped out
in fbefec0 - params are unconditionally unknown); for-in over unknown stays unknown;
in-range literal-array index reads are `T | null`; `?? ` join suites hold.

## THE AMPLIFIER (fix first or nothing else surfaces)

**`getNarrowedTypeAtPosition`'s engine/legacy merge structurally discards the honest
answer** (typeChecker.ts ~5038-5087):
- The engine result is kept only when it DIFFERS from `symbol.dataType` - but the
  honest post-if join for a parameter is exactly `join(T, unknown) = unknown =
  declared`, so "the write did not survive the join" is by construction dropped.
- `moreNarrowed` picks the STRICT SUBTYPE with no soundness arbitration, and
  `isSubtypeOfUnion` (typeNarrowing.ts ~187) does NOT treat UNKNOWN as top - so a
  stale/unsound definite `T` beats the honest `T | unknown` every time. Its comment
  ("both are sound narrowings... never a widening") states an invariant the legacy
  input does not satisfy.
- Consequence: the flow engine already computes the correct type for probes 1/2/4 and
  NO consumer can ever see it; the post-visit rescue filters are dead weight for
  identifier receivers.

## RANKED FINDINGS (code-audited; empirical status noted)

### Tier 1 - identifier SSA (the machinery the 0.7.81/0.7.84 fixes didn't reach)

- **I-1. Single-slot `currentType` is branch-blind** (semanticAnalyzer ~6006/6025/6034
  write it; effectiveSymbolType's fast path symbolTable ~293 returns it bare for any
  position >= effectiveFrom). `typeHistory` entries have NO branch context - while
  `PropertyWriteEntry.branches` (0.7.84) does, produced by the already-existing
  `branchStack`, consumed in exactly one place. Fix = mirror 0.7.84: snapshot
  branchStack in `recordTypeHistory`, make the fast path union conditional writes /
  exclude sibling-branch writes. [probes 1, and the UC5005 FP mirror
  `if (c) x = null; x.foo`]
- **I-2. typeChecker ~4406 reads `sym.currentType || sym.dataType` with NO position
  check at all** - the last write anywhere in the file types every read, including
  reads BEFORE the write; feeds hard UC5003. Same pattern: semanticAnalyzer ~7345,
  hover.ts ~334. Cheapest high-impact fix, independent of branch machinery.
- **I-3. Loop-body writes -> definite post-loop currentType** [probe 2].
  **CLOSED 0.7.92 — user ruled for SOUNDNESS (2026-08-04).** Read-before-write
  half: loop-extent stamps + back-edge union in both walks + UC2009
  post-filter (docs/uc2009-loop-read-before-write-null.md). Post-loop half:
  in-loop MEMBER writes are union-only (writeDefiniteForRead/
  writeInvisibleToRead/elseType all gate on `e.loop`), matching the 0.7.85
  identifier contract — rv.days is `object | unknown` post-loop and the
  honest may-null warning on keys(rv.days) is the accepted cost (the code's
  own `rv.days ? … : null` guard proves the path is real). Derived bindings
  (`let snap = x;`) are re-stamped post-analysis from complete history
  (restampDerivedBindings — widen-only, concrete members only). keys() now
  refines a maybe-object arg to `array<string> | null`.
- **I-4. branchStack only pushed by visitIfStatement** - switch cases, ternary arms,
  `&&`/`||` RHS, try/catch bodies, and FUNCTION BODIES [probe 5 - UC2015 FP today]
  are invisible to both the 0.7.84 member fix and any future identifier fix. Function
  bodies are the worst: a write in a never-called function replaces an outer symbol's
  member type (member path REPLACES; identifier path at least unions declared).
- **I-5. forceGlobalDeclaration sets currentType without effectiveFrom**
  (symbolTable ~1061) - invisible to effectiveSymbolType but visible to the
  position-blind readers (I-2). The `global.X = <object|function|array>` binders
  (semanticAnalyzer ~6095-6140) are un-gated while the SCALAR binder already has the
  `scalarSSAEligible` straight-line gate - extend that gate to the three siblings.
  [probe 6]
- **I-6. Closure-deferred writes share the slot** (`let x = 1; function g(){x="s";}`
  - post-body positions see `string` even if g never runs). Known hazard, patched
  only for UC1002/2010 suppression (typeChecker ~2780).
- **I-7. updateSymbolType / patchForwardCallDependencies / alias-init copy**
  (symbolTable ~1044, semanticAnalyzer ~4646, ~7798) - overwrite dataType/currentType
  with no union/history; the alias copy launders an unsound currentType into a
  DECLARED type, unreachable even by the 0.7.81 union.

### Tier 2 - narrowing / guards

- **N-1. Var-to-var LOOSE `==`/`!=` equality narrowing REPLACES the type**
  (typeChecker ~6557 dispatch; applyTypeGuard ~5396 replace-not-intersect). The
  literal path 12 lines above correctly excludes `==` ("a match proves nothing");
  the var-var path doesn't, and `0 == "0"` is true. Narrowing FP shape code-verified;
  the specific for-in UC2009 probe did not fire (wrong consumer) - hover/UC2004/UC5003
  paths remain. Fix: gate on `===`/`!==`, or restrict to reference-typed `y` (where
  ucode `==` IS pointer identity).
- **N-2. `match: 0` in STRING_CONTRACT_GLOBAL_BUILTINS** (typeChecker ~98) - ucode
  COERCES match's subject (lib.c uc_cast_string; `match(123,/2/)` -> ["2"]); the repo
  documents this itself in builtinValidation ~882. A truthy match() proves only
  non-null. Locked in by tests/syntax/test-string-contract-narrowing.test.js -
  update it. Other 8 entries verified correct.
- **N-3. Numeric-comparison guard fabricates `integer|double` from unknown**
  (~6567-6590 via intersectNarrowType's UNKNOWN short-circuit ~5376). `null < 5` is
  TRUE (null coerces to 0) - the guard excludes nothing but always-truthy references.
  Fix at the guard-production site; keep as a refiner of already-numeric unions.
- **N-4. `|| t === 'unknown'` whitelisted in the UNION branches of
  narrowBuiltinReturnType (~3599) and narrowFsReturnType (~2757)** - a
  `string | unknown` arg makes split() etc. return definite `array`, deleting the
  null. The scalar branches two lines earlier AND builtinValidation ~385 already do
  it right - three implementations, one wrong. Delete the whitelist from
  allCompatible (keep in noneCompatible).
- **N-5. guardCache key has no separator** (~5464: `variableName + '' + position` -
  the comment says `\0`, the code concatenates). `x`@1234 collides with `x1`@234:
  cross-variable guard leakage, non-deterministic. One-character fix.
- **N-6. Flow-engine assignment transfer only sees top-level Identifier targets**
  (flowTypeEngine ~62-95): chained/nested/member assignments never invalidate the
  env; combined with the amplifier, stale narrower env types win.
- **N-7. removeNullFromType/removeTypesFromUnion return UNKNOWN (TOP) for
  fully-narrowed-away (BOTTOM)** - an impossible path can re-acquire any type via a
  later keepOnlyTypes. NEVER_TYPE exists; use it.

### Tier 3 - inference helpers

- **H-1. Implicit-null return missing from return unions** [probe 3 - crash]. Bare
  `return;` IS recorded as null; only fall-off-the-end is missed. The CFG machinery
  (functionNeverReturns, exit-predecessor walk) already exists in
  narrowFunctionReturnType - push NULL when a reachable exit predecessor is not a
  ReturnStatement. Covers declarations, fn expressions, block arrows.
- **H-2. Cross-file factory returnType hard-codes OBJECT** (fileResolver ~2468) even
  when branches return null/fall through; collectReturnObjectProperties ignores
  non-object returns; and computeFunctionReturnInfo OUT-RANKS the (correct)
  inferFunctionReturnType. In-file twin is correct - imports change the verdict.
  Sub-bug: intersection merge takes branch 0's property types verbatim (also in-file
  twin ~4430).
- **H-3. Dict value-shape read `m[k]` never includes `| null`** (typeChecker
  ~4142-4153, binding at semanticAnalyzer ~3187) - the canonical registry-lookup
  idiom; missing key is null. FN-confirmed (deref probe clean, crash). The bucket
  `??=` gate right above is sound - reuse its dominance check.
- **H-4. pop()/shift() claim definite element type** (builtinValidation ~2388-2408) -
  empty array returns null; the C-comment on the same lines says so. Sibling
  push/unshift already fixed (#121). FN-only (==null exempt from UC2009).
- **H-5. Array per-index element types are flat and branch-less** (write typeChecker
  ~4546 sets propertyTypes directly - the 0.7.83 audit's "wrong-symbol write" site -
  read ~4214 bypasses propertyTypeAt). Indices never got 0.7.81/0.7.84 treatment;
  the general fallback right below already returns `element | null`.
- **H-6. Array literal drops unknown elements from the element union** (~4678-4692):
  `[1, p]` types `array<integer>`; the cross-file twin (fileResolver ~3044) folds
  unknown back in explicitly. Make the in-file path match.
- **H-7. Cross-file inferReturnArgType claims non-null builtin results**
  (fileResolver ~2970: split->ARRAY not array|null etc., hex/int wrong too).
- **H-8. Cross-file `return <local>` resolves the declarator init, ignoring
  reassignment** (~3013, self-documented); **H-9.** JSDoc partially-resolvable union
  keeps only the resolvable arm definite (semanticAnalyzer ~4071 - the one JSDoc
  case outside the trusted-annotation contract); **H-10.** getCommonType promotes
  [int,double]->double (typeCompatibility ~101); **H-11.** loadfile()() injected
  scalars definite regardless of conditionality (~2322).

## KNOWN / CONTRACTUAL (deliberate; revisit only with user sign-off)

- Loop bodies are not branch frames (rv.days contract, test-pinned). Probes 2/B1 are
  its measured FN cost - extending branch treatment to loops is a CONTRACT CHANGE.
- JSDoc annotations are trusted (except H-9). guard-invalidation only on literal-null
  RHS (probe 4's root, documented ~5580) - revisit alongside the amplifier fix.
- flowTypeEngine's join: unknown absorbs as TOP (join(T,unknown)=unknown, not
  T|unknown) - documented; it is also why the engine's honest answer canonically
  equals `declared` and gets filtered by the amplifier.
- UC2009 bails when either side contains UNKNOWN (~2063) and on `== null` (~2031) -
  the safety valves every fix should aim to restore types INTO.
- length()/null-propagation guards: VERIFIED SOUND this audit (length(null)=null,
  null>0 false; negation correctly suppressed) - the old memory note overstated.

## Suggested fix order

1. **Amplifier** (getNarrowedTypeAtPosition merge + isSubtypeOfUnion UNKNOWN-as-top +
   moreNarrowed join-on-incomparable) - otherwise engine corrections stay invisible.
2. **One-liners with outsized blast radius:** N-5 cache key; N-4 unknown whitelist;
   N-2 match entry (+test update); H-4 pop/shift; I-2 position-blind 4406 (+7345,
   hover 334).
3. **I-1 identifier branch context** (mirror 0.7.84: recordTypeHistory snapshots
   branchStack; effectiveSymbolType fast path honors it) + **I-4 push branchStack for
   switch/ternary/&&/try/function-bodies** (fixes probe 5's live UC2015 FP and
   extends 0.7.84 automatically).
4. **H-1 implicit-null returns** (CFG machinery already in place).
5. **H-3 dict-read null, H-2 cross-file factory, I-5 global binder gate, H-5 index
   history, N-1/N-3 guard gates.**
6. Loop contract decision (I-3 + rv.days) - user call.
