# Inferred parameter types never reach the type checker (and module args are never checked at all)

**Status:** ✅ IMPLEMENTED (0.7.70) — `src/analysis/inferredParamRevalidation.ts`,
`TypeChecker.checkModuleArgumentTypes`, `src/analysis/checkers/moduleArgValidation.ts`
**Found:** 2026-07-08, from user review of the 0.7.69 guided tour (`zzzz/demo-0.7.69-guided-tour.uc`)
**Related:** `docs/tc-callsite-param-inference-local.md` (the pass that produces the types), `docs/TRIAGE-2026-07-07-type-coverage.md`

**Corpus result:** 40 diagnostics removed, 40 added. Net count unchanged; the content
moved from `unknown` to concrete. 11 of the additions are module-argument warnings (a
new capability); the module check adds **zero errors**, by design.

Two independent defects that compose into one visible symptom: a function
whose parameter is *provably* the wrong type for the builtin/module function it
is passed to produces **no diagnostic at all**.

---

## Symptom (the report)

```ucode
function cmd_output(c) {          // hover: c: string | integer | object
    let p = fsx.popen(c, 'r');    // popen(command: string) — NO DIAGNOSTIC
    return p;
}
cmd_output('dnsmasq --version');
cmd_output(1);
cmd_output({'1': 5});
```

The inference is **correct**. Closed world, three call sites, `c` genuinely is
`string | integer | object`. The bug is entirely downstream of it.

### Not a bug: `printf("%d", <string>)`

The report also flagged this as suspicious:

```ucode
function command_help(cmd, help) {  // hover: cmd: string, help: string
    printf("%-25s%d\n", cmd, help); // %d given a string — no UC2007
}
```

**Correct by design.** `ucode/lib.c uc_printf_common` reads `%d` through
`ucv_to_integer(arg)`, which coerces — `printf("%d", "42")` prints `42`. Only a
*statically non-numeric string LITERAL* is provably wrong (it silently becomes 0),
which is exactly what `formatArgMismatches` checks (`builtinValidation.ts:1758`).
A `string`-typed **variable** is not provably wrong.

Inference does improve `printf` where it can: an inferred `object`/`array` argument
to `%d` has no coercion contract and now fires UC2007.

---

## Part 1 — the inferred type is hover-only

`inferCallsiteParamTypes` (`semanticAnalyzer.ts:392`) runs as a post-pass, long
after `this.visit(ast)` (line 375) already drove `typeChecker.checkNode()` over
every call argument and emitted its diagnostics against `unknown`.

Isolating probe (`match()` is a builtin that *does* validate its first argument):

```ucode
function f1(x) { return match(x, /a/); }  f1(1);    // x inferred: integer  (WRONG type)
function f3(x) { return match(x, /a/); }  f3("s");  // x inferred: string   (RIGHT type)
```

Both emit, identically:

```
warning incompatible-function-argument: Argument 1 of match() is unknown.
  Use a type guard to narrow to string.
```

So the checker sees `unknown` for **both**. Three consequences:

1. **False negative.** `f1(1)` puts an integer into `match()`. Never flagged.
2. **Stale noise.** `f3` is *correctly* `string`; we still nag "is unknown".
3. **Two consumers disagreeing.** Hover says `string`, the diagnostic says
   `unknown`. This is exactly the pathology `docs/tc-loop-carried-flow-join.md`
   was written to eliminate, reintroduced one layer up.

The ticket's advertised guarantee — *"adds and removes exactly zero
diagnostics, by architecture"* — is true, but it buys neutrality by **throwing
the information away**.

### Why a naive re-run does not work

- `checkNode()` has no cache short-circuit, so it *does* recompute — but
  `checkIdentifier` (`typeChecker.ts:902`) uses the **scope-stack**
  `symbolTable.lookup()`, not `lookupAtPosition`. Post-visit every function
  scope has been popped, so a parameter name resolves to `null` → `UNKNOWN`.
- Worse, `checkNodeInner`'s write guard (`typeChecker.ts:746-763`) is
  `if (result !== UNKNOWN || !nodeTypes.has(node))` — so that fresh `UNKNOWN`
  **refuses to overwrite** the cached value, and validation keeps reading the
  stale pre-inference type.
- Validation reads `getNodeTypeDescription` → `getFullTypeFromNode` → the
  `nodeTypes` **cache first** (`typeChecker.ts:2300-2312`), *not* the symbol
  table. `inferCallsiteParamTypes` only mutates `paramSym.dataType` and
  `fnSym.parameters[p].type` — it never touches `nodeTypes`.

### The hook

`typeChecker.setTypeOf(node, type)` (`typeChecker.ts:779`) is public and
overwrites unconditionally. Stamping the *argument identifier nodes* of every
inferred parameter makes `getNodeTypeDescription`'s first branch pick up the
inferred type, and validation follows.

### Fix

A new post-pass, `revalidateInferredParamCalls`, placed immediately after
`inferCallsiteParamTypes`:

1. For each parameter symbol stamped by inference, walk its function body and
   `setTypeOf(idNode, inferredType)` on every **read** of it (skipping the
   parameter declaration itself and non-variable identifier positions).
2. Collect every `CallExpression` in those bodies with at least one argument
   whose subtree contains such an identifier.
3. For each, restore the truthiness depth recorded during the main visit
   (`typeChecker.setTruthinessDepth`), re-run `checkNode(callNode)` with the
   `checkNodeQuietly` snapshot/truncate idiom (`typeChecker.ts:530`) so only
   the *newly appended* diagnostics are captured,
4. Drop the call's stale argument diagnostics from `this.diagnostics`, then
   re-emit the fresh ones through `addDiagnostic`.

**Gotchas established by inspection, all load-bearing:**

- `getResult()` (`typeChecker.ts:870`) is **non-destructive** — every drain site
  re-emits the whole accumulated buffer. `addDiagnostic` dedups on
  `(message, severity, range)`, *not* on `code`. So a re-run is idempotent only
  when the message is byte-identical; a changed message ("is unknown" →
  "expects string, got integer") at the same range yields **both** unless the
  stale one is explicitly removed. Hence step 4.
- `BuiltinValidator.resetErrors()` (`builtinValidation.ts:2652`) clears **only
  `errors`**, not `warnings`; `resetWarnings()` exists and is dead code. Since
  UC2006/UC2007 and most argument diagnostics are *warnings*, `resetErrors()` is
  the wrong tool. Use the snapshot/truncate idiom.
- `checkNode` no-ops inside incremental "clean ranges"
  (`typeChecker.ts:732-734`). The post-pass must clear them or skip.
- Truthiness context is set by the *visitor* around `checkNode`
  (`semanticAnalyzer.ts:5419-5421`) and reset to 0. Re-running without it flips
  `inTruthinessContext`/`safeInTestContext` suppression and invents FPs in
  `if (length(x))`-style tests.
- UC2007 skips any argument whose type `.includes(' | ')`
  (`builtinValidation.ts:1890`). An inferred **union** (`string | integer`) is
  therefore still not format-checked. Out of scope here; noted.

### This will NOT be diagnostic-neutral

By design. It converts a cosmetic hover improvement into real bug-finding. It
will surface true positives (the `cmd_output` report is one) and may surface
false positives wherever the escape analysis is too optimistic. Corpus delta
must be measured and reviewed line by line before this lands.

---

## Part 2 — module member call arguments are never type-checked

Independent of Part 1. `fsx.popen(1, 'r')` with a **literal** integer also emits
nothing.

The signature is fully declared (`fsModuleTypes.ts:110-118`):

```ts
["popen", {
  name: "popen",
  parameters: [
    { name: "command", type: "string", optional: false },
    { name: "mode", type: "string", optional: true, defaultValue: "r" }
  ],
  returnType: "fs.proc | null",
  ...
}],
```

**The gap is "param types are declared but never checked."**

`checkArgumentTypes` (`typeChecker.ts:2986`) — the only positional argument
validator in the codebase — has exactly two call sites:

| line | caller | covers |
|---|---|---|
| `typeChecker.ts:2963` | `validateBuiltinCall` | global builtins (`length`, `match`, …) |
| `typeChecker.ts:3114` | `checkUserFunctionCall` | user/JSDoc-typed functions |

All four module-member call paths in `checkCallExpression` resolve **only a
return type** and return immediately:

- namespace call `fs.popen(...)` — `typeChecker.ts:2739-2755`
- named import `popen(...)` — `typeChecker.ts:2564-2574`
- aliased variable `fs_mod.popen` — `typeChecker.ts:2598-2607`
- chained `require('fs').popen(...)` — `typeChecker.ts:2779-2793`

The only consumer of the declared parameter types on the diagnostic path is
`narrowFsReturnType` (`typeChecker.ts:2439`), which bails unless
`nullMeansWrongType` is set (3 fs entries do; `popen` does not) and in any case
only adjusts the *return* type — it never pushes a diagnostic.
`SemanticAnalyzer.validateModuleMember` (`semanticAnalyzer.ts:5089`) validates
the method **name**, version gating and platform gating. Zero arity checking,
zero argument-type checking.

Scope: **199 functions across 23 module registries**, 176 of them with declared
parameters.

### The declared type vocabulary is not `UcodeType`

Enumerated across all registries:

```
  82  string          22  function        6  string | number     2  number | string | null
  71  number          18  integer         6  array               2  number | string | string[]
  43  any             13  object          5  number | string     2  string | object
                      10  boolean         3  string | number[] | SocketAddress
```

…plus one-offs: `string | regexp`, `string | integer`, `string | null`,
`string | string[]`, `string | SocketAddress`, `socket | PollSpec`,
`integer | fs.file | fs.proc | socket.socket`,
`string | module:fs.file | module:fs.proc`, `fs.stat.perm`, `fs.stat.dev`.

Note `number` is **not** a `UcodeType` — it means `integer | double`. And `any`
(43 occurrences) must be skipped outright.

### Fix

#### ⚠️ First, the load-bearing finding: the registry types are documentation-grade

A naive dispatch produced **8 UC2004 warnings on the corpus, and all 8 were false
positives.** Every one traced to the registry describing the *documented* calling
convention rather than the *checkable* contract. Verified against the vendored C:

| # | Corpus site | Registry says | ucode C says | Root cause |
|---|---|---|---|---|
| 5 | `wireless.uc` — `ubus.call({object: …})` | `object: string` | `args_get_named(vm, nargs, "object", 0, REQUIRED, …)` — type code `0` = *no constraint*; accepts UC_INTEGER **or** UC_STRING; and every ubus fn accepts a single **named-args object** in place of positional args | `args_get_named` |
| 1 | `unetmsgd-remote.uc` — `ubus.open_channel({…})` | `integer` | same | `args_get_named` |
| 1 | `docker_socket.uc` — `socket.addrinfo(host, port)` | `service: string` | `"service", UC_NULL, true, &serv` — UC_NULL = no constraint; a numeric port is valid | wrong type string |
| 1 | `mwan4track.uc` — `uloop.timer(ms, track_cycle)` | `callback: function` | `let track_cycle; // forward declaration` … assigned at line 321 | deferred execution |

A second round surfaced a fifth cause: `uloop.timer(ms, …)` / `uloop.signal(sig, …)`
warned "may be **double**", because `uc_uloop_timer` does `t = ucv_int64_get(timeout)`
and `parse_signo` falls through to `ucv_to_number(sigspec)` — **both coerce**. Worse,
the `integer | double` being complained about is *synthetic*: it is exactly what
0.7.69's arith-on-unknown rule assigns to `u - 1`.

`grep -c args_get_named ucode/lib/*.c` → **only `lib/ubus.c`** (6 sites), so the worst
cause is contained. But one of the ~8 exercised entries (`socket.addrinfo`) was simply
wrong. Treat every registry parameter type as unverified until read against the C.

#### The four gates, each forced by a real false positive

- **Exclude `ubus`** (`MODULES_WITHOUT_POSITIONAL_ARG_CONTRACT`) — `args_get_named`.
- **INTEGER ≡ DOUBLE at any numeric parameter** — the C coerces, and `integer | double`
  is often synthetic.
- **Skip `null` actuals** — already covered by UC5005/UC5006, and otherwise reproduces
  the `docs/forward-let-fn-uc1002.md` forward-declaration FP one layer down.
- **Fixed the `socket.addrinfo` registry entry** (`service: string` → `any`), verified
  against `ucode/lib/socket.c`.

#### The rest of the design

Add `checkModuleArgumentTypes`, dispatched from all four module-member call
paths. Conservative from day one:

- **Warnings only, never errors.** `ucode/lib/fs.c uc_fs_popen` does
  `if (ucv_type(comm) != UC_STRING) err_return(EINVAL);` → the call **returns null**,
  it does not throw. That is the `gracefulNull` shape, which warns.
- Map only the unambiguous type strings to allowed `UcodeType` sets:
  `string`, `integer`, `boolean`, `object`, `array`, `function`,
  `number → {integer, double}`, and unions built solely from those.
- **Skip the parameter entirely** for `any`, for any handle/custom name
  (`SocketAddress`, `PollSpec`, `fs.stat.perm`, `module:fs.file`, …), and for
  any union containing one.
- **Skip an `unknown`/`any`-typed actual argument** (`flagUnknownActual: false`).
  The builtin preset flags unknowns; adopting it here would fire on every
  unannotated parameter passed to `fs.*` — precisely the false-positive cliff
  `inferCallsiteParamTypes` exists to shrink. Flagging unknowns should be a
  follow-on, gated behind `ucode.strictUnknownArguments`.
- Respect `optional` and `isRest`; never validate past a rest parameter.
- Definite mismatch → the same `incompatible-function-argument` /
  `nullable-argument` machinery builtins use, so quick fixes keep working.

---

## Acceptance criteria

```ucode
// Part 1 — inferred types are checked
function f1(x) { return match(x, /a/); }  f1(1);
//                     ^ EXPECT a definite-mismatch diagnostic (integer into a string param)

function f3(x) { return match(x, /a/); }  f3("s");
//                     ^ EXPECT NO DIAGNOSTIC (was: "Argument 1 of match() is unknown")

function f4(x) { return match(x, /a/); }  let esc = f4;   // escapes → x stays unknown
//                     ^ EXPECT the existing "is unknown" warning, unchanged

function f6(v) { printf("%d\n", v); }     f6("str");
//                              ^ EXPECT NO DIAGNOSTIC — ucv_to_integer coerces a string.
//                                (An earlier draft of this ticket asserted UC2007 here.
//                                 That was wrong; see "Not a bug" above.)

function f7(v) { printf("%d\n", v); }     f7({a: 1});
//                              ^ EXPECT UC2007 — an object has no coercion contract.

// Part 2 — module args are checked
fsx.popen(1, 'r');        // EXPECT definite-mismatch WARNING (integer into `command: string`)
fsx.popen("cmd", 'r');    // EXPECT NO DIAGNOSTIC
fsx.popen(unknownVal, 'r'); // EXPECT NO DIAGNOSTIC (unknown actual is skipped)
ubus.call({object: "x", method: "y"});  // EXPECT NO DIAGNOSTIC (args_get_named)
uloop.timer(msMaybeDouble, cb);         // EXPECT NO DIAGNOSTIC (integer ≡ double)
socket.addrinfo("host", 443);           // EXPECT NO DIAGNOSTIC (service is unconstrained)

// Composed — the original report
function cmd_output(c) { return fsx.popen(c, 'r'); }
cmd_output('x'); cmd_output(1); cmd_output({'1': 5});
//                                ^ EXPECT a diagnostic on `c` (string | integer | object)
```

Plus: no regression in the full suite; corpus diagnostic delta reviewed.

## Known limitations of the shipped fix

- **Bare-identifier arguments only.** `f(x)` is re-validated; `f(x + 1)` is not. A
  composite argument's cached type was computed with `x` unknown, and re-running
  `checkNode` recomputes bottom-up through `checkIdentifier`, which post-visit cannot
  resolve a parameter (scopes are popped). Stamping only helps where the validator reads
  the argument node's own cache entry.
- **Reassigned parameters are skipped entirely.** `function f(x) { x = 1; match(x, …) }`
  — the call-site union describes `x` at ENTRY, not after the rebind. (The existing SSA
  machinery already types that read correctly; the gate exists so we don't *overwrite* it
  and delete a true positive.)
- **Variable types are not recomputed.** In `function foo(x) { let parts = split(x, ","); }`
  with `foo("test")`, `x` hovers `string` but `parts` still hovers `array<string> | null`
  — the declaration's type was inferred during the main visit, before the parameter was
  typed. The revalidation pass re-runs *argument validation*, not variable-type inference.
  Asserted in `tests/inference/test-split-return-type.js` so the staleness is visible.
  A follow-on could re-run declaration inference for the affected bodies.
- **UC2007 skips unions.** `builtinValidation.ts:1890` bails on any argument type
  containing `' | '`, so an inferred `string | integer` is still not format-checked.

## Out of scope (deliberate)

- UC2007 on a **union**-typed argument (`builtinValidation.ts:1890` skips
  `.includes(' | ')`). Separate ticket.
- Flagging `unknown` actual arguments at module calls (needs the
  `strictUnknownArguments` gate).
- Arity checking for module calls.
- Cross-file call-site inference (`tc-callsite-param-inference-crossfile.md`).
