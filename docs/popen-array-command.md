# `fs.popen()` now accepts an array command (shell-free fork/exec)

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (UC2004 will become a false positive the moment a
target ≥ the change exists; the newest-master target tier already models "newest"). Found
2026-08-01 reviewing upstream `3ec4e5c..81205a2`.

## TL;DR

Upstream `dfca643` ("fs: reimplement popen() with fork/exec and true shell-free array support",
merged `ee83580`, 2026-07): `popen(command, mode)` was reimplemented with `fork`/`exec`:

- `command` is now **`string | array`** (JSDoc: `{string|Array<*>}`). A string still goes
  through `/bin/sh -c`; an **array** is executed directly via `execvp` (argv semantics, no shell,
  no quoting hazards): `popen(["ls", "-la", "/tmp"], "r")`.
- Array elements are stringified with `ucv_to_string` (so numbers etc. are fine → `Array<*>`).
- Empty array → `EINVAL` (popen returns null).
- New **pre-fork validation** of `argv[0]`: ENOENT/EISDIR/EACCES surface via `fs.error()`
  *immediately* (old shell path only failed at read time with exit code 127).

Verified on Linux (debian:bookworm docker, built at `81205a2`):
`popen(["echo", "hi array linux"], "r").read("all")` → works;
`popen(["/nonexistent/x"], "r")` → null + `error()` = "No such file or directory".

⚠️ macOS note: on the mac build of `81205a2` the **array** form segfaults (string form fine) —
looks like an upstream mac-only bug in the new fork/exec path; do not "verify" against the mac
binary and conclude the feature is broken. (Consider reporting upstream; irrelevant to OpenWrt
targets.)

## Current LSP behavior (verified via CLI)

`popen(["echo", "hi"], "r")` → **UC2004** "Function 'fs.popen' expects string for argument 1,
got array — it will return null". That is *correct* for every current OpenWrt pin (old
`uc_fs_popen` does `if (ucv_type(comm) != UC_STRING) err_return(EINVAL)`) and *wrong* for
upstream master.

## What to build

1. `src/analysis/fsModuleTypes.ts` popen signature (~line 110): `command: string | array`,
   **version-gated per-member** — the per-member `introducedIn` infra from 0.7.66
   (hostapd/wpas work) is the model. Same "no pin ships it yet" tier question as
   [shorthand-method-declarations.md](shorthand-method-declarations.md): gate on the
   newest/master tier.
2. The UC2004 arg check (typeChecker.ts ~3248-3264 documents the `UC_STRING` contract): accept
   array on targets ≥ `dfca643`; keep flagging (with today's message) below.
3. Hover/signature docs: document the two forms + shell-free semantics + empty-array EINVAL +
   pre-fork errno behavior.
4. `fileResolver.ts:2903` (`case 'popen': return 'fs.proc'`) — return type unchanged; no work.

## Tests

- Target=deployed pin: array arg still UC2004.
- Target=master tier: array arg clean; `popen([], …)` could warn (always EINVAL → null) —
  optional constant-fold lint; string arg unchanged everywhere.
- Hover shows `string | array` only on the gated tier.
