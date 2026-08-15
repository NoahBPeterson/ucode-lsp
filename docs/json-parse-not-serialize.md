# `json(<non-string>)` — parse-only builtin misused as a serializer

Status: **BUILT 0.8.10 (uncommitted, awaiting user test).** Filed mid-session
during the `as`-ban work; real-world motivation below.

## As built

`UC2017` in `validateJsonFunction`, plus a `sprintf("%J", value)` quick fix
(`jsonSerializeFix` payload → server.ts, AST offsets, `isPreferred`).
**60 tests** in `tests/diagnostics/test-json-parse-only.test.js`; demo at
`zzzz/json-parse-only-demo.uc`.

### The verdict, three ways

`jsonSourceReadability(node)` → `readable | not-readable | unknown`, computed by
`effectiveMembers()`: own members (object-literal keys, tracked `propertyTypes`,
or the initializer literal) merged with the **prototype chain**, recursing
through `proto()` initializers and bare `proto(name, P);` statements, depth-
capped at 8. Then:

**Severity rule (user, 2026-08-14): a PROVEN throw is an error; if we cannot
tell whether it throws, warn.** Every verdict below follows it. `json(null)` is
also a proven throw and errors, but through the existing argument-type check —
`sprintf("%J", null)` would be wrong advice.

**A string LITERAL is validated as JSON text** before any of this
(`src/analysis/jsonTextValidator.ts`): json-c raises a syntax error on malformed
input, so `json('{1:2}')` throws on every call. Validated against **json-c's**
grammar, NOT `JSON.parse` — json-c accepts single-quoted strings/keys, trailing
commas, block comments, `NaN`/`Infinity` and leading zeros, so the JS parser
would false-positive on working input. Differential-tested against owrt-main
over 42 cases: **42 agree, 0 mismatches**. Rejected (and flagged): unquoted keys
(`{1:2}`, `{a:1}`), `.5`, `+1`, `0x10`, trailing content after the value, empty
or whitespace-only, and unterminated `[1,2` / `{"a":1`.

| verdict | emitted |
|---|---|
| readable — a callable `read` found anywhere in the chain, or a known handle | silent |
| **not-readable** — members fully visible, no callable `read` | **error** |
| unknown, argument could be JSON text (string, `string\|null`) | silent — the ordinary arg-type check has better null-aware wording |
| unknown, argument is an opaque object/array or wholly unknown | **warning** (error under `'use strict'` + `strictUnknownArguments`) — unless the call is inside a `try`/`catch` |

The guarded exemption mirrors UC8001: a `try`/`catch` already handles the throw,
so the nudge adds nothing. Measured on the corpus, **6 of 8** unprovable sites
were already guarded. A PROVEN throw still errors either way — code that always
raises is a bug whether or not it is caught (`dropGuardedUnprovableJsonDiagnostics`,
gated on the `jsonUnprovable` data flag).

### Verified against the interpreter (owrt-main, 2026-08-14)

| call | runtime | our verdict |
|---|---|---|
| `json('{"a":1}')` | OK | silent |
| `json({a:1})` / `json([1,2])` | throws `Input object does not implement read() method` | error |
| `json(1)` / `json(2.5)` / `json(true)` | throws `Passed value is neither a string nor an object` | error |
| `json(null)` | throws (same) | left to the null check — `sprintf("%J", null)` is wrong advice |
| `json(open(…))` / `json(popen(…))` | OK (`type()` is `resource`) | silent |
| `json({ read: fn })` duck-typed | OK | silent |
| `json(proto([…], {read}))` | OK, 1- **and** 2-level chains | silent |
| `proto([], { read: 5 })` | throws — `read` must be **callable** | error |
| `proto(5, …)` | throws — scalars have no prototype slot | (scalars already error) |
| second `proto(v, P2)` | REPLACES the prototype | ambiguous ⇒ `unknown` |

### Corrections the build made to this ticket

1. **A duck-typed reader is real.** `json({ read: function(n){…} })` works, so
   flagging every bare-`OBJECT` argument was a live false positive.
2. **A null argument is NOT a serializer mix-up.** `sprintf("%J", null)` is wrong
   advice; UC2017 excludes NULL.
3. **UC8001 must not pile on.** "Wrap it in try/catch" contradicts UC2017's fix,
   so `checkUnguardedThrowingCalls` skips any call already covered by UC2017
   (`hasCertainThrowDiagnostic`) — the same deference the uhttpd `loadfile` case
   gives UC8011.
4. **`proto()` beats a naive static rule.** ucode's own json() docs build a
   streaming source by attaching `read()` to an **array**, so "arrays can never
   have read()" was false and hard-errored documented, working code. The
   readability analysis replaced the guess. Prototypes are otherwise punted to
   `docs/prototypes-as-a-first-class-concept.md` (completion/hover/go-to-def).

Also updated: the **hover doc** for `json()` (src/builtins.ts), which said
"Parse JSON string or stringify value" — the exact misconception behind the
field bug.

**Related FP filed, NOT fixed:** `this` inside a proto'd method is typed
`object` unconditionally → docs/this-in-prototype-methods.md.

**Pre-existing FP found while sweeping** (already a UC2004 error before this
work): `luci-app-tailscale-community/…/tailscale.uc:58,211` do
`json(join('', out.stdout))` where the local `exec()` returns `{stdout: ''}` on
one path and `{stdout: split(…)}` on another; we collapse that merged shape so
`join()` infers exactly `null`. Worth its own ticket.

## The bug class (field report)

In a GL.iNet tree, `upgrade.uc:93` did:

```ucode
writef("/tmp/upgrade_req.json", json(obj));   // threw on EVERY call
```

ucode's `json()` **parses; it cannot serialize**. `json(<plain table>)` throws
`Input object does not implement read() method`, so the `http_post_json`
helper — and the gray firmware-check API behind it — could never have worked.
The correct serializer is `sprintf("%J", obj)`. Every other `json()` call in
that tree (20 sites) was a correct string-argument parse; the misuse was
isolated but fatal where it occurred.

## Ground truth (vendored ucode/lib.c, `uc_json` ~line 3626)

Verified in source this session:

- `UC_STRING` → parses the string. ✔ the only "normal" use.
- `UC_RESOURCE | UC_OBJECT | UC_ARRAY` → `uc_json_from_object`: requires a
  **callable `read` property** (streaming parse, 1024-byte chunks — this is
  how `json(fs.open(...))` works). A plain dict/array has no callable `read`
  → `EXCEPTION_TYPE: "Input object does not implement read() method"`.
- anything else (int, double, bool, null) →
  `EXCEPTION_TYPE: "Passed value is neither a string nor an object"`.

So the legality condition on `json(x)` is: `x` is a string, or an object with
a callable `read()`. It NEVER serializes.

## The diagnostic

Flag `json(arg)` when `arg`'s inferred type **provably cannot** satisfy that
condition (next free UC2xxx code; severity **error** — it throws on every
execution):

- Object/array/number/double/boolean/null **literals** → error. (The
  serializer-intent case: `json({...})`, `json(cfg)`.)
- Inferred types with **no string member and no read-capable member**:
  `integer|double|boolean|null`, `array<T>`, plain dict types
  (valuePropertyTypes without a callable `read`) → error.
- **Allowed / silent**: string (any union containing string), UNKNOWN/ANY,
  and known read()-bearing object kinds — fs.file, fs.proc, fs "std handle"
  objects, socket handles if their registry exposes `read`; check
  `objectExports`/registry membership rather than hardcoding names. A dict
  type WITH a callable `read` property member is also legal (duck-typed
  streaming source).
- Message must follow the grokable-diagnostics rules (what's wrong + what the
  code does, no internals): e.g. *"`json()` parses JSON — it cannot
  serialize. Passing this <object/array/number> throws at runtime. To
  serialize, use `sprintf(\"%J\", value)`."*

### Quick fix

`json(val)` → `sprintf("%J", val)` — AST-based (rebuild from the call node's
argument offsets, per the quick-fixes-must-be-AST-based rule), `isPreferred`.
Offer it when the argument is object/array-typed (serializer intent); for
number/bool literals the fix is likely still what the author meant, offer it
there too.

### Interplay

- UC8001 (unguarded throwing call) already nudges `json()` toward try/catch —
  unchanged and orthogonal: this new check fires on the *argument type*, and
  an in-try `json(obj)` is still a guaranteed throw worth an error.
- The builtin's registered param type today is permissive; route the check
  through builtinValidation's per-builtin special cases (where printf/UC2006
  style checks live).

### Verification

- Container oracle: `ucode -e 'json({a:1})'` / `json(1)` / `json("1")` /
  `json(fs.open(...))` on owrt-main + a release pin.
- Corpus sweep: expect ZERO new diagnostics across the tracked corpora (the
  glinet tree's one misuse is outside the repo corpora; all in-repo uses are
  string parses) — any in-repo hit is either a real find or an
  inference-precision bug to fix before landing.
- Tests: literal cases (object/array/number/bool/null), inferred-dict case,
  fs.open streaming case NOT flagged, string/union-with-string NOT flagged,
  UNKNOWN not flagged, quick-fix text exactness.
