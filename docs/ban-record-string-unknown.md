# Rid the codebase of `Record<string, unknown>` — and keep it out

Status: **BUILT 2026-08-09, COMMITTED 7503a6c (0.8.8)** — user-requested
2026-08-09; scope EXPANDED same day to a full ban on the `unknown` and `any`
types everywhere in src/ (not just the `Record` forms, and no ratchet — total
eradication in one pass). Final numbers: **842 → 0** AST-level violations
(oxlint's count; the original grep-based inventory undercounted — it missed
generic positions and a whole file, incrementalCache.ts). Verification: tsc
clean, `bun run compile` (now lint-gated) green, both test systems green
(4,473/0 fast suite + mocha aggregate), and the corpus mega-sweep over 283
files / 93,523 lines came out exactly **−0/+0** (after re-baselining: two
glinet corpus files in ~/Downloads changed on disk mid-session and initially
masqueraded as diffs). `SKIP_BAN_LINT=1` bypasses the test-fast gate for
mid-refactor runs only. Incidental dead code found by the union's narrowing
(all provably unreachable, removed without behavior change): a
`'UpdateExpression'` check in incrementalCache (not a ucode node kind — `x++`
is UnaryExpression), `tryNode.catch`/`tryNode.finalizer` probes in
semanticAnalyzer (fields don't exist; catch bodies were never descended —
preserved as-is), `'StringLiteral'`/`literalType === 'integer'` comparisons in
fileResolver. **Follow-up (same day, user-approved, 0.8.8): the two of those
that were real bugs are FIXED** — `++`/`--` now count as outward writes in the
incremental purity classifier (a `g++`-only body is no longer skippable), and
UC8001 now walks catch bodies as unguarded (inheriting the OUTER try context,
so a nested try/catch under an outer try stays silent). 6 + 2 new tests;
corpus sweep still −0/+0 (no corpus file throws inside a catch body). One deliberately weak remnant: semanticAnalyzer's local
`type DiagnosticData = object` (payloads are per-error-code contracts; a
precise union is future work — `object` contains no banned tokens).

## As executed (2026-08-09)

The root cause of every bag-cast was that `AstNode` was a *base interface*, so
`node.type === 'X'` never narrowed and every consumer cast its way out. Fix
order actually used:

1. `AstNode` is now the real discriminated union (`AstNodeBase` base interface
   + completed `AstNodeType` union — 5 kinds were missing: JsDocComment and the
   4 import/export specifiers — + `type AstNode = AstNodeType` + a
   `Exclude<AstNodeKind, AstNodeType['type']> extends never` static totality
   assert). Whole codebase compiled with only 7 fallout errors.
2. `src/ast/astChildren.ts`: total-switch `astChildren`/`forEachAstChild`/
   `walkAst` (zero casts — the union narrows per case); typeChecker's
   `getChildNodes` now delegates to it.
3. Per-file eradication of all `unknown`/`any`/`Record<string, unknown|any>`
   type syntax (~842 AST-level occurrences by oxlint's count).
4. Enforcement — **oxlint** (devDependency, Rust, ~50ms over src/) with
   `.oxlintrc.json`: stock `typescript/no-explicit-any` (catches every `any`
   incl. `as any` and `Record<string, any>`) + a custom JS plugin
   `scripts/oxlint/ban-types-plugin.mjs` whose `ban-types/no-unknown` rule
   reports every `TSUnknownKeyword` (catches `: unknown`, `as unknown`, and
   the `unknown` inside `Record<string, unknown>`). AST-based, so comment
   prose and string literals mentioning any/unknown are never false-flagged —
   this is why the originally-planned grep script (`check-banned-types.mjs`)
   was dropped. Wired as the first step of `bun run compile`, `bun run
   package` (so `vscode:prepublish` gates too), and `scripts/test-fast.mjs`;
   standalone via `bun run lint`.

## The ruling

`Record<string, unknown>` is an anti-pattern in this codebase. It is a hack
around the (already forbidden) untyped/`any` escape hatches: casting an AST
node to a string-indexed bag and walking `Object.keys(n)` throws away the
entire `AstNodeKind` discriminated union — the same union we deliberately made
exhaustive so that *adding a node type is a compile error until every consumer
handles it*. Every `(n as Record<string, unknown>)[k]` walk silently opts out
of that guarantee: it visits synthetic `_`-prefixed fields unless each site
remembers to skip them, it can't distinguish child nodes from scalar fields,
and a new AST field (or a renamed one) changes its behavior with no compile
error anywhere. `Record<string, any>` is the same hack with even less honesty.

## Inventory (2026-08-09)

71 × `Record<string, unknown>` + 2 × `Record<string, any>` across 17 files:

| File | Count |
|---|---|
| src/analysis/semanticAnalyzer.ts | 38 |
| src/analysis/typeChecker.ts | 11 |
| src/server.ts | 4 |
| src/signatureHelp.ts | 3 |
| src/hover.ts, src/ast/scopeRoles.ts | 2 each |
| 11 more files | 1 each |

Nearly all sites are one of three shapes:

1. **Generic AST child walks** (the overwhelming majority):
   `for (const k of Object.keys(n)) { const v = (n as Record<string, unknown>)[k]; … }`
   with hand-copied skip lists (`leadingJsDoc`, `_`-prefixed). ~15 near-identical
   copies of this loop exist in the analyzer alone.
2. **Diagnostic/data bags**: `data` payloads built as string-indexed objects
   (`const diagData: Record<string, any> = {…}` in builtinValidation) even
   though `server.ts` has a real `DiagnosticData` interface on the consuming end.
3. **Field pokes**: one-off reads of a known field through the bag cast
   (`(n as Record<string, unknown>)['init']`) because the node wasn't narrowed
   to its union member first.

## The fix

1. **One typed walk utility** replaces shape 1. Export from `src/ast/`:
   ```ts
   /** The AST children of `node`, in field order, skipping synthetic
    *  (`_`-prefixed) and non-node fields. Built ON the discriminated union —
    *  new node kinds are a compile error here, not a silent walk change. */
   export function astChildren(node: AstNode): AstNode[];
   export function forEachAstChild(node: AstNode, visit: (child: AstNode) => void): void;
   ```
   Implementation reuses the exhaustive `getChildNodes` switch (typeChecker
   already has one; hoist it next to `scopeRoles.ts`, which proved the TOTAL-
   Record pattern: a `Record<AstNodeKind, …>` over the union makes every new
   node kind a compile error until classified). Every generic walk — collectors,
   invalidation scans, def/read passes — routes through it. Walks that need the
   raw field name (rare) get `astChildEntries(node): [field: string, child: AstNode][]`.
2. **Real interfaces** replace shape 2: builtinValidation's `diagData` literals
   get typed against (a checker-side mirror of) `DiagnosticData` so the emitting
   and consuming ends can no longer drift.
3. **Union narrowing** replaces shape 3: sites poking one field first narrow via
   `node.type === '…'` and use the member type, like the rest of the codebase.
4. **Static enforcement** — reintroduction must not compile. The repo has no
   ESLint; don't add one for a single rule. Instead:
   - `scripts/check-banned-types.mjs`: scans `src/**/*.ts` for
     `Record<string, unknown>`, `Record<string, any>`, `: any`, `as any`
     (string/regex level, comment-aware); exits non-zero listing offenders.
     No allowlist — absolute.
   - Wire it as the FIRST step of `bun run compile` (before webpack) and into
     `scripts/test-fast.mjs`, so both the build and the test gate fail. A green
     build is then a proof of absence.
   - `as any` currently has ~300 hits mixed into the `: any`/`as any` count —
     the enforcement script starts by banning the two `Record` forms
     IMMEDIATELY (count is 0 after this ticket lands) and gates the `any`
     forms behind a ratchet (fail if the count INCREASES over the checked-in
     baseline) until their own eradication ticket retires the baseline file.

## Order of work

1. Land `astChildren`/`forEachAstChild` + migrate semanticAnalyzer's 38 (the
   walks are near-identical — most sites become one-liners).
2. typeChecker's 11 (its own getChildNodes becomes the shared implementation).
3. The 17 scattered singles + the two `Record<string, any>` data bags.
4. Land the enforcement script wired into compile + test-fast, count at zero.
5. Full gauntlet: both suites + the 282-file mega-sweep must be **−0/+0** —
   this is a pure refactor; any diagnostic movement is a bug in the migration.

Sizing: one focused session. The walk-migration is mechanical but each site's
skip-list quirks (`leadingJsDoc`, `_`-fields, `parent`) must be preserved
exactly — the utility's default behavior is the union of today's skip lists,
verified by the sweep.
