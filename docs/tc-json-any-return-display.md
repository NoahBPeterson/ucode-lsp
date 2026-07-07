# `json()` (and other "returns any value" builtins) surface as `unknown` — no way to say "any, by contract"

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

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
