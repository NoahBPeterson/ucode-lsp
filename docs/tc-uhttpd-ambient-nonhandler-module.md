# uhttpd ambient misses handler-support MODULES (uspot portal.uc)

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

2 no-hover occurrences (small, but a real hole in the 0.7.56 uhttpd ambient design):

```
uspot/files/usr/share/uspot/portal.uc(232,…): no-hover: 'uhttpd'   ×2
    for (let chunk = uhttpd.recv(64); chunk != null; chunk = uhttpd.recv(64))
```

`portal.uc` is not a `{% %}` template and never assigns `global.handle_request` — it's a
**module** (`return { …, handle_request: function(env) { … } }`) that uspot's actual uhttpd
handler scripts require() and delegate to. Its `handle_request` property DOES run inside a
uhttpd request context at runtime, so `uhttpd.recv()` is valid there — but the ambient is
declared only when `isUhttpdHandler` (template + `global.handle_request`,
`semanticAnalyzer.ts:517-521` / `declareUhttpdAmbient`), so in portal.uc `uhttpd` is a plain
UC1001 undefined variable with no hover.

This gate is DELIBERATE for the general case — `docs/done/uhttpd-false-negatives.md` (FN-5)
removed `uhttpd` from `KNOWN_HOST_GLOBALS` precisely so a non-handler script referencing
`uhttpd` gets UC1001. The miss is the delegation pattern: request-context code factored into a
required module.

## Root cause

Handler detection is strictly single-file and syntactic (`result.isUhttpdHandler` =
`detectTemplateMode` + `global.handle_request` assignment). There is no cross-file notion of
"module whose exported function is invoked from a uhttpd handler's request context", so the
ambient (declared via `declareUhttpdAmbient`'s `forceGlobalDeclaration` pre-traversal) never
fires for portal.uc.

## Proposed approach

Options, weakest-coupling first:

1. **In-file signal — exported `handle_request` member**: a module whose returned/exported
   object carries a `handle_request` property (the exact shape UC8013 already recognizes as
   "handler entry in the wrong form" for templates) is overwhelmingly handler-support code.
   Declare the uhttpd ambient there too, but keep it WEAK: suppress UC1001 + type
   `uhttpd.recv/send/…`, without exempting the file from non-handler diagnostics. Cheap,
   single-file, matches the one real corpus case.
2. **Cross-file gating**: propagate handler context through the import graph — if a detected
   handler imports module M (uspot's handlers require portal.uc), declare the ambient in M.
   Sounder attribution, but needs the workspace import index at analyze time (same wiring the
   include-scope index already has in server.ts:720-726) and a story for the CLI.
3. **Do nothing + document**: 2 occurrences; the UC1001 is arguably useful ("this module only
   works under uhttpd"). If chosen, record the decision in
   `docs/done/uhttpd-false-negatives.md`'s FN-5 section instead.

Recommendation: option 1 — it reuses the existing UC8013 shape detection
(`wrongFormHandleRequest`, `semanticAnalyzer.ts:8487`) as a positive signal rather than an
error, and cannot leak the ambient into arbitrary non-handler scripts. NOTE: UC8013 must not
fire for this shape when the file is a plain module (it currently only fires for template
files, so no conflict — verify with a test).

## Test cases

- `uspot/files/usr/share/uspot/portal.uc` — `uhttpd.recv(64)` resolves (typed
  `string | null` per uhttpdTypes), hovers, completes; no UC1001 on `uhttpd`.
- A random non-handler script referencing `uhttpd` still gets UC1001 (FN-5 regression guard).
- A module returning `{ handle_request: fn }` gets the ambient; a module returning an object
  WITHOUT that key does not.

## Classification

**Partially solvable** (option 1 covers the observed pattern; perfect attribution needs
cross-file context). 2 occurrences in the corpus.
