# `json()` (and other "returns any value" builtins) surface as `unknown` — no way to say "any, by contract"

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Added `UcodeType.ANY` display sentinel; wired `json()` and `call()` returns to it; zero diagnostic change verified on the full luci/ corpus (isolated diff against a copy of the tree with only this change reverted).

## The gap

`json()` genuinely returns *any* JSON value — that is its C contract, not a modeling failure. But the
LSP has no way to express "any value, by design", so the registry types it `UNKNOWN` and every
hover/coverage probe on a parse result reads as a typing miss, indistinguishable from "the analyzer
gave up":

```ucode
// luci/applications/luci-app-tailscale-community/root/usr/share/rpcd/ucode/tailscale.uc:59-62
let status_data = json(join('', status_json_output.stdout));   // status_data: unknown
data.version = status_data?.Version || 'Unknown';              // unknown
data.health  = status_data?.Health  || '';                     // unknown

// unetacl/files/usr/share/ucode/unetacl/service.uc:21-31 — a wrapper propagates it
function load_json(file) { … return json(data); }              // load_json(): unknown | null
let data = load_json(obj.config_file);                          // data: unknown | null

// firewall4/root/usr/share/ucode/fw4.uc:578-594 — read_state() returns json(fd.read("all"))
```

Audit occurrences (direct): `decl-from-call:json` 31 + `read-of-call-result:json` 62 = **93**, plus
user wrappers that only propagate it — `load_json` 8, `json_cmd` 3, `read_jsonfile` 1,
`fw4.read_state()` reads and similar downstream cascades. **~110+ occurrences**, and every one is
counted as a coverage failure by `--type-coverage` even though the type is as precise as it can be.

## Root cause

- `src/analysis/typeChecker.ts:396` — `{ name: 'json', parameters: [UcodeType.UNKNOWN], returnType:
  UcodeType.UNKNOWN }` (same at `src/analysis/symbolTable.ts:494`).
- `UcodeType` (`src/analysis/symbolTable.ts:18-30`) has **no `ANY`** — `UNKNOWN` does double duty as
  both "no information" and "any value by contract".
- Ground truth: `ucode/lib.c:3618` (`uc_json`) parses a string/readable resource and returns the
  parsed value — the docstring is literally `@returns {*}`. A scalar JSON document (`json("5")`,
  `json("null")`) returns an integer/null, so the accurate concrete contract is
  `object | array | string | integer | double | boolean | null`.
- Same "any by contract" family: `call()` (`typeChecker.ts:428` — returns whatever the called
  function returns), `assert()` (:427, returns its first arg), `pop`/`shift` on element-untyped
  arrays (:384-385 — element type genuinely unknown *when the array is untyped*, but see
  tc-callsite-param-inference-*.md for typing the array itself).

## Proposed approach

Decide, as a product/display question, how "any by contract" should read. Options:

**Option A — concrete JSON union.** Type `json()` as the 7-member union above. Accurate and needs no
type-system change, but the union is unwieldy in hover, and member access on it (the dominant use:
`status_data?.Version`) would have to be tolerated on the object member of the union without noise —
effectively the same leniency `unknown` gets today, so the practical win is display + coverage
accounting only.

**Option B — an `ANY` display sentinel (preferred).** Add `UcodeType.ANY` (or a boolean flag on the
signature) that behaves exactly like `UNKNOWN` in every check (top type, no false positives) but
*displays* as `any` in hover and is counted as **typed** by `--type-coverage`. Registry migration is a
handful of lines (`json`, `call`, `assert`, and wrapper-return propagation falls out for free since
the sentinel flows like any type). This cleanly separates "we know it can be anything" from "we
failed to infer", which is exactly the distinction the audit needs.

Wrapper propagation (`load_json(): any | null`) works in both options through the existing
return-type inference — nothing extra needed.

Prior art to respect: `docs/auto-docs/113-union-with-unknown-not-collapsed.md` (deferral note: tests
deliberately construct `T | unknown` unions) — Option B sidesteps that dispute since `any | null`
stays a meaningful union.

## Classification

**Solvable** (display/representation design; no soundness risk — the sentinel must behave as top in
all checks). **~110 occurrences** directly in the audit; also removes the "unknown argument" lint
noise class on parse results (`substr(json(x).field, …)` warnings) noted in
`docs/done/108-is-unknown-mislabels-nullable.md`.

## Fix (Option B, as proposed)

**`UcodeType.ANY = 'any'`** added to the enum (`src/analysis/symbolTable.ts:29-37`, right after
`UNKNOWN`). It is a pure *display* sentinel: every CHECK collapses it to `UNKNOWN` at the single
chokepoints already used to consume a rich type for its "base kind" —

- `dataTypeToBase` (`symbolTable.ts:225-231`) and `singleTypeToBase` (`symbolTable.ts:101-107`) both
  map `ANY → UNKNOWN`. These two functions are the blessed way essentially all compatibility/
  narrowing/argument-checking code consumes a type's base kind, so this one change makes ANY
  transparent to the overwhelming majority of the ~240 `UcodeType.UNKNOWN` comparison sites in
  `typeChecker.ts`/`semanticAnalyzer.ts`/`builtinValidation.ts`/etc. **without touching them.**
- `typeChecker.ts`'s private `getTypeDescription` (the internal validation/gating **string** helper
  used by `builtinValidation.ts` et al., via `setTypeChecker(this.getNodeTypeDescription.bind(this))`
  — separate from the user-facing `typeToString`) also collapses `ANY → 'unknown'` as its very first
  line, so none of `builtinValidation.ts`'s dozen-plus `argType === UcodeType.UNKNOWN` / `.includes(' |
  ')` string comparisons needed to change either.
- A handful of **raw, un-collapsed** `=== UNKNOWN` chokepoints that sit *before* the base-collapse
  (guard/narrowing application, not base-kind consumption) needed an explicit `|| === ANY` companion,
  found by tracing an actual `type(x)=="object"` guard end-to-end and by running the full corpus diff
  (not just static reasoning) until it was clean:
  - `typeNarrowing.ts` `keepOnlyTypes` (the "UNKNOWN → narrow to the guarded type" branch) and (for
    engine-internal symmetry, though never exercised by a real caller — no declared/expected type is
    ever ANY, only VALUES are) `isTypeCompatible`'s `expectedType` side.
  - `typeChecker.ts` `intersectNarrowType` (equality/comparison-guard narrowing: "base `unknown`/`any`
    carries no info → take the narrow type verbatim").
  - `semanticAnalyzer.ts`'s variable-declaration identifier-narrowing lookup (`if (sym.dataType ===
    UcodeType.UNKNOWN) { …getNarrowedTypeAtPosition… }`) — gated the SAME way for ANY, or
    `let x = json(y); if (type(x)=="object") { let z = x; }` left `z` as `any` instead of narrowing to
    `object` (caught by an end-to-end hover test, not by static review).
  - `flowTypeEngine.ts` `joinTypes` (CFG merge-point absorption — see Union/join decision below).
- `typeToString`/`singleTypeToString` need **no change** to render `any` — a bare `UcodeType.ANY`
  string already falls through to the "plain enum" case and prints its own value (`'any'`). Only the
  union display-order `rank()` helper got `any` added alongside `unknown` (renders before `null`).
- `hover.ts`: three `ts !== 'unknown'` / `baseTypeStr === 'unknown'` guards (member-hover fallback
  paths) were widened to also treat `'any'` as "no useful narrowed type / no known shape", matching
  existing UNKNOWN handling exactly (display-only, no diagnostic involved).
- `src/cli.ts` needed **no change at all** — `hoverDisplayedType`'s coverage regex is `/\bunknown\b/`,
  which simply never matches the string `any`.

### Which builtin returns became ANY (with C citations)

- **`json()`** — `ucode/lib.c:3619` (`uc_json`) → `ucode/lib.c:3661` `rv = ucv_from_json(vm, jso);`.
  Genuinely returns any parsed JSON value (object/array/string/int/double/bool/null).
  Registries updated: `symbolTable.ts:513` (`initializeBuiltins`) and `typeChecker.ts:407`
  (`FunctionSignature[]`) — both must agree since semanticAnalyzer's variable-declaration inference
  reads the symbolTable registry (`inferFunctionCallReturnType`) while inline/argument checking reads
  the typeChecker registry.
- **`call()`** — `ucode/lib.c:5738` (`uc_callfunc`) → returns `res = uc_vm_stack_pop(vm)`, literally
  whatever the invoked function returned. Same two registries updated (`symbolTable.ts:542`,
  `typeChecker.ts:441`).
- **`assert()`** — **NOT converted**, despite the ticket's proposed-approach text listing it. Verified
  at `ucode/lib.c:4268` (`return ucv_get(cond);`) that it's exactly as "any by contract" as the above
  two. But its two registries currently **disagree** on the pre-existing type
  (`symbolTable.ts` says `NULL`, `typeChecker.ts` says `UNKNOWN`) — a latent bug unrelated to this
  ticket. Converting it would silently "fix" that bug as a side effect and risks a real (if arguably
  correct) diagnostic-visible change I could not fully audit in the time available; deferred to its
  own ticket rather than conflated here. `ubus.call`'s payload was checked too
  (`src/analysis/ubusTypes.ts:23`, `returnType: 'object | null'`) — its C contract is "an object
  reply, or null on error", not "any JSON value" (unlike `json()`, the top-level shape is always an
  object), so it was intentionally left alone.

### Union / join semantics (as recommended)

- **`any | null` renders as `any | null`** — verified (`load_json()`-style wrapper propagation, see
  demo). Ordinary union construction (`createUnionType`) is untouched; ANY is just another
  `SingleType` member.
- **Joining `any` with a concrete type at a CFG merge point: `any` absorbs**, exactly like `unknown`
  does today (`flowTypeEngine.ts` `joinTypes`) — no `T | any` union is formed at a flow-merge, for the
  same reason `T | unknown` isn't (a narrowed-on-one-path/unguarded-on-the-other `if` must not
  re-widen). Display refinement: when `any` is one of the two joined sides, the merge result is `any`
  (not bare `unknown`) — it's the more informative "provably any by contract" rather than "no
  information". This is display-only; both results collapse to the same base (`UNKNOWN`) for checks.
- Note this is distinct from `getCommonType` (`checkers/typeCompatibility.ts`, used for a *function's*
  inferred return type across multiple `return` statements) — that function is **not** touched and
  deliberately keeps forming real unions with `unknown`/`any` members (prior art:
  `docs/auto-docs/113-union-with-unknown-not-collapsed.md`), which is exactly what makes
  `load_json(): any | null` a "meaningful union" rather than noise.

### Verification

- `npx tsc --noEmit`: clean.
- Full corpus diff (`node bin/ucode-lsp.js luci/` vs. an isolated copy of the tree with **only** this
  ticket's edits reversed — a plain HEAD-only baseline was contaminated by concurrent peer work
  already in the shared tree, so a naive before/after wasn't valid): **zero diagnostic differences**.
- `--type-coverage luci/`: 67.8% → 68.6% (2068 → 2012 unknown-type occurrences; +56 attributable
  specifically to this change, on top of whatever the peers' concurrent work already fixed).
- `bun run test:fast`: 3217/3217 pass (268 files). `tests/test-all-validations.test.js`: 231/231 suites,
  2870 tests.
- New test file: `tests/test-tc-any-display.test.js` (10 tests) — json()/call() hover as `any`; a
  genuine unknown still hovers `unknown`; `any | null` union display; `type(x)=="object"` narrowing on
  an any-typed `x`; any-vs-unknown diagnostic PARITY for a strict-typed builtin argument and for member
  access; `--type-coverage` doesn't flag an any-typed variable but still flags a genuine unknown.
- Demo: `zzzz/demo-tc-any.uc` (gitignored, hover expectations verified against the real server).

### Pre-existing tests updated (enum-exhaustiveness only — no semantics changed)

Per `feedback_exhaustive_type_tests`, several tests use `effect`'s `Match.exhaustive` over every
`UcodeType` value specifically so a new enum member fails loudly until it's covered. Adding `ANY`
tripped five such tests; each got a new `Match.when(UcodeType.ANY, …)` case (documented inline) that
asserts ANY behaves like UNKNOWN wherever the existing UNKNOWN case does, or is skipped the same way
UNKNOWN/UNION already are where a type can't be produced by a literal:

- `tests/syntax/test-type-narrowing-engine.test.js` — `reprForType`; `refSubtype` extended (`a===ANY ||
  e===ANY` alongside the existing UNKNOWN clauses); the `isSubtypeOfUnion`/`containsType` generic loops
  needed base-collision fixes too (ANY and UNKNOWN now share a base, which a raw-identity `!==` filter
  didn't account for) — documented inline, not a semantics change, a test-generalization forced by
  CONCRETE now containing two types with the same base.
- `tests/hover/test-flow-sensitive-hover.js`, `tests/diagnostics/test-small-fixes-0624.js`,
  `tests/diagnostics/test-array-property-diagnostic.js` — `Match.when(UcodeType.ANY, () => null)`
  (skipped, same treatment as UNKNOWN: no literal assigns ANY directly).
- `tests/syntax/test-hex-int-nan.js` (three separate exhaustive matches) — `hex(any)`/`int(any)` assert
  the SAME result as `hex(unknown)`/`int(unknown)` (`'integer | double'`), verified via a new
  `appliedAny()` helper (mirrors the existing `applied()` fn-param trick, using a `json()`-derived
  value instead of a bare parameter, since ANY has no literal either).

No test asserting the literal string `'unknown'` for what is now `'any'` needed updating — a
corpus-wide grep across `tests/` for `json(`/`call(` combined with `unknown` found no existing test
that asserted json()'s or call()'s return type as the string `unknown`.

### Peer-region tsc errors ignored

None — `npx tsc --noEmit` was clean both before and after.
