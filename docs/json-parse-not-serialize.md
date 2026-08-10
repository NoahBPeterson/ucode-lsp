# `json(<non-string>)` — parse-only builtin misused as a serializer

Status: **OPEN — vital, user-requested 2026-08-09.** Filed mid-session during
the `as`-ban work; real-world motivation below.

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
