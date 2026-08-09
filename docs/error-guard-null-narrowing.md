# Error-guard null narrowing (the `require_param` idiom)

Status: **BUILT — 0.8.5 (2026-08-09).** This was the concrete, corpus-grounded
form of the long-open "correlated-flag narrowing" item
(docs/TRIAGE-2026-07-07-type-coverage.md STILL-OPEN list).

Shipped shape (all five phases, in one pass):
- `src/analysis/nullGuardContract.ts` — contract inference from guard bodies
  (`inferNullGuardParams`, WeakMap-cached): a param is flagged when a top-level
  `if (T) <always-return-truthy>` has a top-level ||-arm null test of it and no
  earlier statement contains a falsy-capable own return. Content validators
  match nothing, by construction.
- Cross-file: `fileResolver.getNamedExportNullGuardParams` (shares the export
  node resolution with the param-signature extractor via
  `resolveNamedExportFunctionNode`); stamped as `Symbol.nullGuardParams` at the
  named-import site. Same-file callees resolve lazily from the declaration AST
  (`functionNodeForSymbol` — FUNCTION symbols store their *identifier* node, so
  a per-AST id-position index recovers the declaration).
- Application lives in the GUARD LAYER (`collectGuards`), not the flow engine's
  env: `falsyImpliedNonNullPaths` fires on the terminating-`if (err)` sibling
  fall-through (incl. `continue`/`break` and user neverReturns terminators), the
  `if (err) … else` branch, the POSITIVE `if (!err)` branch (any `!flag` conjunct
  of the test), both ternary shapes (`err ? bail : use`, `!err ? use : bail`),
  `err || use(v)` (flag arms of a `||`), and (mid-chain, no flag involved) the
  `||`-RHS — `require_param('x', v) || validate_name(v)` narrows v at the
  validate_name argument. Member paths (`req.args.id`) work via getDottedPath;
  aliases (`let rp = require_param`) carry the contract (import stamp copy +
  lazy initNode-identifier hops).
- The IIFE/object-method fix that fell out: `getGuardsForPosition`'s cache was
  being POISONED by out-of-order quiet walks (the 0.8.3 IIFE return pre-walk
  runs before the body's `err` symbol exists, caching an empty guard set the
  real pass then reads). `quietDepth` now gates cache writes — quiet checks
  compute but never cache. This is a general staleness fix, not guard-specific.
- NOT ucode, learned the hard way: there is no `throw` statement (nothing in
  lexer.c/compiler.c; our ThrowStatement node type is vestigial) — exceptions
  are raised via die(). Don't add ThrowStatement handling to terminator logic.
- Invalidation: flag reassigned after its initializer; guarded path (or a
  PREFIX — `req.args = …` kills `req.args.id`) written between capture and use
  (`isPathAssignedBetween`); and the loop back edge — a query inside a loop
  that does NOT contain the capture, where the loop body writes the flag or the
  path, drops the implication (`loopCarriedWriteInvalidates`; a loop containing
  the capture re-captures each iteration and stays safe).

Validation: tests/test-error-guard-narrowing.test.js (139 tests in 8 sections:
A contract-inference positives ×27, B contract negatives ×15, C application
forms ×43 — incl. IIFEs, object-literal dispatcher methods, closures, loops,
aliases, exports — D argument forms ×5, E invalidation counterexamples ×26,
F cross-file ×8 — aliased imports, barrel re-exports — G hover ×5, H interplay
×10); podman-api 9 → 4 diagnostics (ALL five null-family FPs gone: L54 match,
L57 b64dec, and the three mid-chain validate_* arg errors — survivors are
unrelated UC8002/UC8014); 86-file corpus AND 96-file vendor differentials both
−0/+0; full suites 4,440/0 + comprehensive. Demo: zzzz/error-guard-demo.uc
(BEFORE/AFTER annotations; sections 8–12 are live deliberate-refusal squiggles).

Mega-sweep (2026-08-09, user-requested): every nested repo + external corpus —
luci, luci-app-podman, wwand, lucihttp, vendored ucode, resources/luci-base,
glinet, the fleet clones, i-love-luci (315KB) — *.uc + *.ut + extensionless
ucode-shebang scripts: 282 files, 93,238 lines, 0 analyze failures, baseline
3,983 → 3,973 diagnostics, **−10 / +0**. The 10 removals are the five podman-api
null-family FPs twice (the workspace checkout and the fleet clone carry two
revisions of the same file). ZERO additions anywhere — no upgrade pairs, no
newly-reachable downstream checks fired on this corpus.

## Repro (luci-app-podman volume CLI helper, verbatim shape)

```ucode
import { validate_int, validate_name, require_param } from 'luci.podman_validate';

function die(msg) { warn(`${msg}\n`); exit(1); }   // neverReturns (already inferred)

let volumeName = ARGV[1];          // string | null (container-read | null)
let compressed = ARGV[2];
let volumeData = ARGV[3];

let err = require_param('volumeName', volumeName) || validate_name(volumeName)
       || require_param('volumeData', volumeData)
       || require_param('compressed', compressed) || validate_int(compressed);
if (err) die(err);

let decoded = b64dec(volumeData);  // volumeData STILL string | null — should be string
```

Where `require_param` (cross-file, luci.podman_validate) is:

```ucode
export function require_param(name, value) {
    if (value == null || value === ''
        || (type(value) === 'object' && length(keys(value)) === 0))
        return `Missing required parameter: ${name}`;
};
```

The user's expectation: after `if (err) die(err);`, null is narrowed out of
`volumeName` / `volumeData` / `compressed`.

## Why it is sound

1. `require_param`'s body returns a NON-EMPTY STRING LITERAL (truthy) on the branch
   whose test includes `value == null`, and falls off the end (implicit null) on
   every other path. Therefore: **result falsy ⇒ `value != null`** (also ⇒ not '',
   but the null arm is the narrowing payload).
2. `err` is the `||` of five calls. `||` yields the first truthy arm, so
   **err falsy ⇒ every arm falsy** — including each `require_param(..., v)` arm.
3. `die` never returns (already inferred via the exit() terminator fixpoint), so
   the code after `if (err) die(err);` is exactly the err-falsy path.
4. Chaining 1+2+3: after the guard, each `v` passed to a `require_param` arm is
   non-null — PROVIDED neither `err` nor any of those `v`s was reassigned between
   the assignment and the guard (write-invalidation is mandatory for soundness).

## Design

**Phase 1 — contract inference** (`nullGuardParams: Set<paramIndex>` on the
function symbol):
- Pattern: every `return <expr>` with a provably-truthy expr (non-empty string
  literal / template literal with literal head, true, non-zero number) is
  dominated by a test containing a top-level `||`-arm of the form
  `param == null` / `param === null` / `!param`; all other paths return
  null/undefined/implicitly. Then falsy-result ⇒ that param non-null.
- Same-file: compute in the analyzer next to return-type inference.
- Cross-file: fileResolver already parses exported function ASTs (return types,
  ParamInfo) — add the same body scan there and carry the set on the imported
  symbol (mirrors the 0.8.2 bracket-optional fix's shape).

**Phase 2 — implication capture**: at `let err = <expr>` where expr is an `||`
chain (or single call): for each arm `f(...)` whose callee has nullGuardParams,
and whose flagged argument is a plain identifier, record on `err`'s symbol
`falsyImplications: Array<{ symbol, position }>`.

**Phase 3 — application**: wherever flow already knows `err` is falsy —
`if (err) <all-paths-terminate>` fall-through, and the plain `else` branch —
strip null from each implied symbol via the same mechanism the existing
`if (!x) return;` guard narrowing uses (flowTypeEngine). Invalidation: any write
to `err` or to an implied symbol between capture and application drops that
implication (loop back-edge stamps from 0.7.92 apply — a capture inside a loop
must not narrow a read reached via the back edge).

## Cautions

- Do NOT infer from `validate_name`/`validate_int` (they reject on CONTENT, not
  nullness — validate_int(null)'s behavior differs); only the null-arm pattern
  licenses non-null. The `||` chain still works: the require_param arms alone
  carry the narrowing.
- This must live in flowTypeEngine (the sound engine), not the retired CFG typing
  path ([[cfg-and-flow-engine]] rules).
- Regression sentinels to add: the verbatim repro above; a reassigned-err
  counterexample; a loop-carried counterexample; cross-file + same-file variants.

---

# Survey (2026-08-09): cost of the gap, payoff, and build plan

## What it costs today (measured, current build)

| # | Where | Diagnostic | Verdict |
|---|-------|-----------|---------|
| 1 | podman-api L54 `match(volumeData, …)` | `nullable-argument` (sev1, strict file) | **FP** — volumeData guarded 3 lines up |
| 2 | podman-api L57 `b64dec(volumeData)` | `nullable-argument` (sev1) | **FP** — same guard |
| 3 | podman-api post-guard hovers | `volumeName`/`volumeData`/`compressed` show `string \| null` | UX lie — the guard proved non-null |
| 4 | pull-worker sock/hdrs/lf wave (historical) | 10+ UC5006 | Mitigated by the 0.8.3 terminator stamping — but only because those were DIRECT `if (!x)` tests; the err-flag form has no such workaround |
| 5 | Suppression pressure | podman-api already carries `// ucode-lsp disable` on imports | Every FP pushes authors toward blanket disables that mask future true positives |

**Frequency of the idiom:** 108 `if (err)` / `if (e)` guard sites across the survey
corpora (glinet + luci-base + podman + wwand); 49 `require_param`/`validate_*`
chain lines in podman.uc alone. Most sites do NOT currently FP — only because the
guarded values happen to be typed non-null (rpcd args via typedefs) or unknown
(unannotated params, which suppress checks). That is the strategic point: **each
typing improvement converts silent sites into FP sites** — it happened three times
in one week (pull-worker sock after `?socket` unions, podman-api after container-
read null, is_remote-adjacent hovers after IIFE inference). The narrowing is the
missing counterweight to every future typing win.

## What building it resolves — and what it deliberately does not

| Outcome | Covered? |
|---------|----------|
| podman-api FPs #1–2 + hover lies #3 | ✅ the verbatim repro |
| Any `let err = f(x) \|\| …; if (err) <bail>` where f null-rejects x | ✅ generic — nothing hardcoded to require_param |
| `if (err) return …;` form (rpcd methods) as well as `die()`/terminators | ✅ blockAlwaysTerminates already handles both |
| Guards over MEMBER paths (`require_param('id', req.args.id)`) | ✅ **required** — rpcd passes member paths, not identifiers; design v1 said "plain identifier" and must be widened to the member-path narrowing the engine already does (0.6.158) |
| `validate_int(x)` / content validators narrowing null | ❌ by design — they reject on CONTENT; only the null-arm pattern licenses non-null (the \|\|-chain still narrows via its require_param arms) |
| cursor()/popen() may-null true positives | ❌ correct diagnostics, out of scope |
| Shape-in-union collapse (`json(hdrs.body_remainder)` unknown) | ❌ separate limitation (ObjectType carries no property map) |
| Reassigned err / loop-carried captures | ❌ deliberately invalidated (soundness) |

## Build plan

| Phase | Work | Where | Size | Risk |
|-------|------|-------|------|------|
| 1 | `nullGuardParams` contract inference from function bodies (truthy return dominated by a `param == null`-arm test; all other paths null/implicit) | semanticAnalyzer, next to return-type inference; stamp on the fn symbol | S | Low — syntactic, conservative |
| 2 | Same contract cross-file for imported guards | fileResolver (mirrors the 0.8.2 bracket-optional fix's shape) | S | Low |
| 3 | Implication capture at `let err = <\|\|-chain>`: per-arm (guarded-expr, position) incl. MEMBER paths; invalidate on any write to err or a guarded expr's base | analyzer declarator/assignment visits; symbol field | M | Medium — write-invalidation must respect loop back-edge stamps (0.7.92) |
| 4 | Application where flow knows err is falsy (post-`if (err) <terminating>`, else-branch): strip null via the existing guard-narrowing path | flowTypeEngine + getGuardsForPosition | M–L | **Highest** — the engine is the soundness-critical core; the loop-backedge campaign is the cautionary tale |
| 5 | Tests: verbatim podman-api repro; reassignment/loop/content-validator counterexamples; cross-file + same-file; corpus differential must show EXACTLY the predicted removals (2 FPs + hover changes, nothing else) | tests/ + diff harness | M | — |

Estimated shape: one focused session (comparable to the 0.7.92 loop-soundness
campaign — same engine, similar blast surface). Phases 1–3 are safe to land alone
(inert until phase 4 consumes them); phase 4 is the gate that wants fresh context
and the corpus differential as its acceptance test.
