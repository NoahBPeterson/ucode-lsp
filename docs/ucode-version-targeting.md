# ucode version targeting

ucode has no semver — OpenWrt pins a dated git snapshot of ucode per release. A few
newer syntax features don't compile on older releases, so the LSP can **target** a
specific OpenWrt release and flag syntax that release's ucode would reject.

## The setting

`ucode.targetVersion` (enum, default `main`):

| value | ucode snapshot | OpenWrt |
|-------|----------------|---------|
| `main` *(default)* | newest | main / snapshot |
| `24.10` | 2025-07-18 | OpenWrt 24.10 |
| `23.05` | 2024-07-11 | OpenWrt 23.05 |
| `22.03` | 2022-12-02 | OpenWrt 22.03 |

Default is `main` — the LSP reflects the language as it currently is. Set an older
release to catch syntax that won't compile on your deploy target.

## How it works

- The version model + the registry of divergent features live in
  **`src/analysis/ucodeVersions.ts`**. Each `VERSION_FEATURES` entry declares the
  release it was `introducedIn`.
- `SemanticAnalyzer.flagVersionFeature(feature, start, end)` emits **UC6005**
  (warning) only when the configured target is *older* than `feature.introducedIn`.
  The message names the target release and points at `ucode.targetVersion`.
- The diagnostic offers two code actions: the compat fix (e.g. "Add ';'") and
  **"Change ucode target version…"** (a quick-pick, command `ucode.selectTargetVersion`).

### Adding a newly-found divergence

1. Verify it against the oracles (below) — confirm which releases reject it.
2. Add one entry to `VERSION_FEATURES` with its `introducedIn` release.
3. Call `this.flagVersionFeature(VERSION_FEATURES.<id>, start, end)` at the detection
   site. (If detection needs a lexical fact like "was there a trailing `;`", record
   it on the AST node in the parser — don't re-scan source text.)

## Known divergences

| feature | introduced | older releases |
|---------|-----------|----------------|
| `export function f(){}` **without** a trailing `;` | `main` (2026-02-11) | 24.10/23.05/22.03 require the `;` |

## Verifying against per-release oracles

Don't trust the system `ucode` binary for syntax — it's an arbitrary (often older)
build. Build the exact ucode each release pins:

```sh
scripts/build-ucode-oracles.sh   # installs ucode_main / ucode24_10 / ucode23_05 / ucode22_03
```

Then `tests/test-target-version-gating.test.js` cross-checks the LSP's UC6005 gating
against those binaries: the LSP must flag a target **iff** that version's ucode
rejects the code. (The cross-check auto-skips if the oracles aren't installed.)
