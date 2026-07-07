# include() deploy-path targets don't resolve to workspace files (snort3 templates)

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

45 no-hover occurrences in the snort3 package are reads of include()-injected names whose
include SITES use the **deployed** path, not the workspace path:

```
packages/net/snort3/files/snort.uc      — 23× 'snort', 7× 'nfq', 2× 'rpad'  (no hover)
packages/net/snort3/files/nftables.uc   —  9× 'nfq',  2× 'snort', 2× 'rpad' (no hover)
```

The provider is right there in the same directory (`packages/net/snort3/files/main.uc:242-246`):

```ucode
include("templates/snort.uc",    { snort, nfq, rpad });
include("templates/nftables.uc", { snort, nfq, rpad });
```

But the targets live at `files/snort.uc` / `files/nftables.uc` in the workspace — the
`templates/` prefix exists only after the package Makefile installs them to
`/usr/share/snort/templates/`. So `resolveIncludePath` (relative to the includer's directory,
per the oracle-verified semantics in `docs/done/ucode-template-mode-support.md` phase 4) looks
for `files/templates/snort.uc`, finds nothing, and the scope `{ snort, nfq, rpad }` is never
injected → UC1001 + no hover on every read (plus the audit's no-hover cluster keys
`call-return:rpad`, since `rpad(...)` calls an injected function).

Same family, different spelling, in uvol (`packages/utils/uvol/files/uvol:37`):
`include("/usr/lib/uvol/uci.uc")` — an ABSOLUTE deployed path whose target sits next to the
includer in the workspace. (uvol's own no-hover counts are dominated by a separate analyzer
crash — see `docs/tc-analyzer-crash-inferredparams-scoperole.md` — but the path-resolution gap
is this ticket.)

## Root cause

The include-scope index (`src/analysis/includeScope.ts`, `buildIncludeScopeIndex` /
`extractIncludeSites`) resolves literal include paths relative to the includer's directory
only. There is no fallback for the two deploy-layout mismatches the corpus actually contains:

1. **Installed-subdir prefix** (snort3): deployed `templates/x.uc` ↔ workspace `x.uc`
   (sibling of the includer).
2. **Absolute deployed path** (uvol): deployed `/usr/lib/uvol/x.uc` ↔ workspace `x.uc`
   (sibling of the includer).

`docs/done/include-scope-resolution.md` (§Fix design, step 1) already proposed the heuristic
for case 2: try `dirname(includingFile)/basename(includePath)` first, then a workspace-wide
basename match, with a configurable prefix map as the robust long-term option. It was designed
for the caller-side leaked-globals merge but applies verbatim to the render-scope index.

## Proposed approach

1. In `resolveIncludePath` (or a wrapper used by `buildIncludeScopeIndex` and
   `collectIncludeGlobals`' `getIncludeTargetStatus`, so the UC3002 "include target not found"
   warning agrees): after the exact relative resolution fails, try
   `dirname(includer)/basename(target)`; if unique, use it. Optionally follow with a
   workspace-unique basename match (only accept a SINGLE candidate — ambiguity → unresolved,
   never guess).
2. Longer term, the `.ucode-lsp.json` prefix map (`/usr/share/snort/templates/` →
   `packages/net/snort3/files/`), shared with the planned association config of
   `docs/call-scope-injection.md` Layer 2c and `docs/planned-runtime-introspection.md`.
3. The injected values here are typed better than firewall4's: `rpad` is a plain in-file
   function (full signature available), `snort`/`nfq` come from `load(...)` returns (partial).
   So with resolution fixed + the hover fallback of `docs/tc-template-render-scope-hover.md`,
   `rpad(…)` gets a real signature hover.

Guard: basename fallback must not hijack a correctly-failing include (e.g. a file that truly
doesn't exist anywhere); keep UC3002 for those, and only suppress it when the heuristic found a
unique candidate.

## Test cases

- snort3: `main.uc`'s two includes resolve to `files/snort.uc`/`files/nftables.uc`; the 45
  injected-name reads gain injection (UC1001 gone in the templates); `include(nfq.include, …)`
  (non-literal, snort.uc:176) still skipped silently.
- uvol: `include("/usr/lib/uvol/uci.uc")` resolves to the sibling `uci.uc`; the caller-side
  `uvol_uci` leak (already handled by `collectIncludeGlobals` for resolvable paths) starts
  working for the absolute-path spelling.
- Negative: `include("does-not-exist-anywhere.uc")` keeps UC3002; a basename that matches TWO
  workspace files resolves to neither.

## Classification

**Partially solvable.** 45 occurrences (snort3). The sibling-basename heuristic solves both
corpus shapes cheaply and soundly (unique-match-only); the fully general deployed↔workspace
mapping needs the config file. Non-literal include paths (`include(plugin, …)`, uvol backends'
34 `backend` occurrences) stay out of scope — that's the association problem of
`docs/call-scope-injection.md` (Layer 2), not path mapping.
