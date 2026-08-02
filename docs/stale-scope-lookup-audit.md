# Stale-scope `symbolTable.lookup()` audit — siblings of the 0.7.82 builtin-shadow bug

Status: **IMPLEMENTED 0.7.83 (uncommitted, awaiting user test).** All seven confirmed
bugs fixed; the two-function API (resolveReference / lookupOpenScopes, plain `lookup`
REMOVED) shipped with the name-keyed index (docs/lookupatposition-index-perf.md — the
big-file total actually got FASTER than before 0.7.82); all flagged BUG-LIKELY /
SUSPICIOUS sites converted except the deliberate keep-list below; enforcement suite
tests/test-symbol-lookup-contracts.test.js; fix tests
tests/diagnostics/test-stale-scope-lookup-fixes.test.js (10). Bonus root-cause found
while fixing #7: visitFunctionDeclaration's hoist check used the CHAIN lookup, so a
NESTED same-name function never got its own symbol and repointed the outer symbol's
declaredAt — now same-scope-only (lookupInCurrentScope). Corpus differential vs 0.7.82:
one change — firewall.uc:655 "Argument 1 of substr() is unknown" FP removed (the
deferred filter can now see the guarded function-local old_name). Original audit below. Follow-up to
docs/foreach-callback-local-builtin-shadow.md (fixed in 63a8364: checkIdentifier now
resolves `lookupAtPosition ?? lookup`). This audit swept all ~144 remaining plain
`symbolTable.lookup(` sites for the same bug class and classified them by execution
window. SEVEN bugs are EMPIRICALLY CONFIRMED (repros below); the rest are code-verified
classifications. Perf prerequisite for the fixes: docs/lookupatposition-index-perf.md.

## The bug class

`lookup(name)` walks only currently-open scopes. Three stale windows exist where the
relevant scope has already exited:

- **W1** — visitIfStatement's post-visit `typeChecker.checkNode(wholeIf)`
  (semanticAnalyzer.ts:6376): branch BLOCK scopes are closed; enclosing function scope
  still open. Reaches everything under dispatchCheck.
- **W2** — buildFlowEngines (post-traversal): ALL non-global scopes closed.
- **W3** — post-visit diagnostic filters + hover/completion/definition handlers
  (post-analysis): ALL non-global scopes closed.

Failure modes: a MISS falls through to builtin/module/global interpretation (the 0.7.82
shape), or a WRONG HIT resolves an outer same-name symbol — and two sites WRITE through
the wrong hit, corrupting the outer symbol persistently.

## CONFIRMED bugs (runnable repros, verified 0.7.82)

### 1. UC2009 via the ranged-call path — typeChecker.ts:1834/1845/1872 (resolveRangedCall)

```ucode
if (true) {
    let index = function (a, b) { return -5; };
    if (index("x", "y") == -5) print("hit", "\n");   // UC2009 "index() returns -1
}                                                     // (not found) or a non-negative
                                                      // index..." — runtime prints hit
```
Same diagnostic code the 0.7.82 fix addressed, reached by a second unfixed route: the
BUILTIN_RETURN_RANGE lint resolves the callee with plain lookup during the W1 re-check.

### 2. UC5003 member-on-array hard error — typeChecker.ts:3951 + 4406 (checkMemberExpression)

```ucode
let cfg = [1, 2, 3];
if (true) {
    let cfg = { name: "eth0" };
    print(cfg.name, "\n");    // UC5003 "Property 'name' does not exist on array type"
}                             // — runtime prints eth0
```
The W1 re-check resolves the OUTER array for the inner object's member access. 4406 even
OVERRIDES the correctly-computed object type with the wrong symbol's type.

### 3. Hover shows io docs for a local `let from` — hover.ts:1224

```ucode
import { from } from 'io';
function f() {
    let from = 42;
    return from;    // hover on `from` → io module from() documentation, not integer
}
```
The 0.7.80 `from`-as-io early-return branch uses an unpositioned lookup and preempts the
main (position-aware) hover path. (`o.from` member hover is NOT affected — verified.)

### 4. Zero completions on a function-local const-container alias — completion.ts:106

```ucode
import * as nl from 'nl80211';
function g() {
    const c = nl.const;
    c.    // 0 completions; the same two lines at module level give all 178 NL80211_*
}
```
`lookupSymbol` is offset-aware but five member-completion callers omit the offset
(completion.ts ~1207/1230/1283/1766/1815) while `offset` sits unused in scope at the
dispatch site (~268-306). (The `import * as fs` shadow shape is NOT affected — an
earlier offset-aware path wins; verified.)

### 5. Element-write CORRUPTS the outer same-name symbol — typeChecker.ts:4553

```ucode
let buf = ["a", "b"];
if (true) {
    let buf = [0, 1];
    buf[0] = 42;              // writes element type onto the OUTER buf symbol
}
if (buf[0] == "a") print("yes", "\n");   // UC2009 "`integer` can never be == \"a\""
                                          // — runtime prints yes
```
The W1 re-check resolves the outer `buf` for the inner assignment and mutates its
propertyTypes; the corruption OUTLIVES the stale window and mis-types later reads.

### 6. Module-signature arg checks on a shadowed namespace local — typeChecker.ts:3010

```ucode
import * as fs from 'fs';
if (true) {
    let fs = { open: function (a, b, c, d, e) { return a; } };
    print(fs.open(1, 2, 3, 4, 5), "\n");   // 3x UC2004 "fs.open expects string..."
}                                           // — checked against the MODULE signature
```

### 7. Nested same-name function OVERWRITES the outer's return type — semanticAnalyzer.ts:9341

```ucode
function halt() { return 1; }
function wrap() {
    function halt() { return "s"; }
    return halt();
}
let r = halt();    // hover: r is `string`; outer halt() "Returns: `string`" — it's 1
```
narrowFunctionReturnType runs post-traversal over ALL functions incl. nested; the nested
`halt`'s scope is closed, plain lookup resolves the OUTER `halt`, and
`symbol.returnType = ...` silently retypes it. Feeds hover, call typing, arg checks.
(The sibling neverReturns write at 9173 did not produce a visible UC4001 in a simple
probe; the write path is the same — verify while fixing.)

## High-priority unconfirmed (code-verified, fix with tests)

Probed WITHOUT reproducing (2026-08-01, shapes in scratchpad): 5042 reversed pair
(outer-null shadow shape came out clean), 5329 functionParamEnv (nested-fn param guard —
silent precision loss only), 5939 collectGuards. Keep the sites in scope for conversion —
the code paths are real — but their user-visible impact is unproven.

- **typeChecker.ts:5042, 5939, 6300, 6344 — REVERSED pairs** (`lookup ?? lookupAtPosition`):
  the wrong outer hit wins before the position-aware query runs. 5042 is
  getNarrowedTypeAtPosition — the chokepoint for UC5005/5006 narrowing; 5939's own
  comment describes the stale-scope hazard then orders the calls backwards. Guard
  results are memoized in guardCache (name+position key), so one stale answer is served
  to all later queries at that position.
- **typeChecker.ts:4553 + 689 — WRONG-SYMBOL WRITES**: `arr[i] = v` element tracking and
  rtnl/nl80211 const injection write propertyTypes onto the outer same-name symbol;
  corruption outlives the window.
- **typeChecker.ts:5329 — functionParamEnv**: runs ONLY in W2 (fully stale); any nested
  function misses and seeds an EMPTY param env for the whole flow fixpoint.
- **semanticAnalyzer.ts:9173 + 9341 — detectUnreachableCode fixpoint**: iterates ALL
  functions incl. nested post-traversal; wrong hit WRITES neverReturns/returnType onto a
  same-named outer function. (Simple probe didn't surface a visible FP yet; the write
  path is real.)
- **semanticAnalyzer.ts:9595** — deferred diagnostic filter; wrong hit can DELETE a
  genuine incompatible-argument error. Only branch in that filter not position-keyed.
- **semanticAnalyzer.ts:1864 + 1827** — throwing-builtin lint (gated behind
  warnUnguardedThrowingCalls): a MISS is treated as "is the real builtin" → FP +
  wrap-in-try quick fix on shadowed user code.
- **typeChecker.ts:3010 / 2993 / 2983** — obj.method() resolution against outer
  namespace import; 3010 pushes module-signature argument errors on a shadowed local.
- **typeChecker.ts:2574 / 2641** — arg-type description fallback (mitigated by the
  nodeTypes cache-first read); **3033** — negated lookup: a missed block-local
  `let fs = …` suppresses its real method types (type loss, no diagnostic);
  **4201 / 3868 / 4825 / 6922 / 797** — lower-severity misc (element typing, nested
  consts, neverReturns gate, ambient enrichment, UC8006 — last two effectively safe);
  **hover.ts:1569 / 1322** — degraded (not wrong) hover on const-container aliases and
  a nested-function property-key gate.

## Deliberately NOT to convert

- semanticAnalyzer.ts:2096 checkExportedNames — module-scope semantics are the point.
- All `lookup('this')` sites — `this` is never block-scoped; innermost-open is correct.
- typeChecker.ts:2903 forward-reference detection — deliberately position-blind (it
  looks for LATER declarations that lookupAtPosition rejects); converting kills UC1009.
- ~80 semanticAnalyzer sites running synchronously during the node's own in-scope visit
  (incl. declare-then-fetch idioms and shadow detection at 2881, which REQUIRES
  current-scope semantics) — correct and faster as-is.

## Conversion notes

- Mechanical form: `lookupAtPosition(name, node.start) ?? lookup(name)`; every flagged
  site has a node with `.start` in hand.
- PERF: lookupAtPosition is an O(allSymbols) linear scan (symbolTable.ts:862). Hot
  converts (member expressions 3951/4406, narrowing chokepoint 5042, arg descriptions
  2574) may need a name-keyed index on allSymbols, or gate the scan on "plain lookup
  missed OR its hit's scope doesn't contain position".
- guardCache keying must be checked when converting the guard extractors, or a stale
  pre-fix entry can mask the fix.
- completion fix is different: thread `offset` through the five helpers.

## Proposed API: two functions with sharp contracts (replaces three ad-hoc patterns)

The current surface invites two recurring mistakes: bare `lookup` in stale windows (this
whole audit) and hand-composed pairs in the WRONG order (4 sites found). Collapse to:

- **`resolveReference(name, position)`** — "which symbol does this identifier occurrence
  denote under ucode's lexical scoping?" Internally `lookupAtPosition ?? lookup`; valid
  in EVERY window (traversal, W1 re-checks, W2/W3 post-passes, hover/completion). The
  open-chain fallback exists ONLY to admit hoisted/forward declarations and stamp-less
  synthetic symbols — it is part of the semantics, not a safety net. Default choice for
  any caller holding an AST node.
- **`lookupOpenScopes(name)`** — today's `lookup`, renamed. "What does this name bind to
  in the scope chain the analyzer is currently INSIDE?" Only meaningful while the
  traversal cursor is at the relevant node; undefined behavior in deferred/post-visit
  contexts. Legitimate callers are a closed set: shadow detection (2881), module-scope /
  export checks (2096), `this` resolution, declare-then-fetch idioms, and the
  deliberately position-blind forward-declaration hunt (typeChecker 2903 / UC1009).

NOT a single function with a `fallbackToLookup` boolean: the two calls answer different
QUESTIONS, and a boolean can't carry the caller's intent — future sites would cargo-cult
`true` and re-blur the semantics. Enforcement:

1. Rename/remove the public `lookup` → every existing call site becomes a COMPILE error
   and each migration is a forced, explicit choice between the two intents (same
   philosophy as the SCOPE_ROLE total-Record pattern).
2. Make `lookupAtPosition` private — the ?? composition lives only inside
   resolveReference, permanently killing the reversed-pair mistake class.
3. Suite-enforced grep test: no `symbolTable.lookup(`/`lookupAtPosition(` outside
   symbolTable.ts; `lookupOpenScopes(` allowed only at the whitelisted intent sites.
4. Window contracts stated in both docstrings.
