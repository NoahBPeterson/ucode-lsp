# Module resolution misses deploy-layout roots — utest `src/`, hostap absolute imports, cross-package siblings

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Tier 1
(files/root deploy-root mapping for absolute imports) and tier 2's zero-config
`X/src/X.uc` package-src-mirror detection are both built in
`src/analysis/fileResolver.ts`'s `resolveImportPath`. Tier 3 (cross-package
deploy-time siblings) is DELIBERATELY NOT built — see "## Fix" below.

## Fix

- **Tier 1 (absolute imports, hostap case) — `resolveImportPath`'s absolute
  branch** (fileResolver.ts, in the `importPath.startsWith('/')` block): after
  the literal-path and workspace-root-relative probes fail, walk the
  importer's ancestors; at any ancestor named `files` or `root` (the OpenWrt
  package-payload convention — both occur in this workspace), probe
  `<ancestor>/<absolute-path>`. Same-package only, existence-gated (sound).
  Clears `/usr/share/hostap/common.uc` from `wifi-scripts/files/usr/share/hostap/wdev.uc`.

- **Tier 2 zero-config detection (utest case) — same function's dotted/bare
  branch, ancestor-walk loop**: alongside the pre-existing `share/ucode` /
  `lib/ucode` mirror-root check, two NEW checks run at every ancestor level:
  (a) `isPackageDeployRoot` — a `root`/`files`-named ancestor additionally
  probes `<ancestor>/usr/{share,lib}/ucode/<dottedPath>` (and the `usr/local`
  pair) — this is tier 2 from `docs/tc-module-root-mapping.md`, built here
  since both tickets touch the same loop; (b) `packageSrcMirror` — an
  ancestor `D` whose `D/src/<basename(D)>.uc` (or `D/src/<basename(D)>/`)
  exists on disk is treated as a search-root mirror at `D/src` (the
  ticket's proposed zero-config heuristic: verified against utest.sh
  `UTEST_SRC=/usr/share/ucode` + the package Makefile, which install `src/*`
  flattened to that path — so `utest/src/utest.uc` existing is same-package
  evidence that `utest/src/` mirrors the install root). Existence-gated both
  ways (the marker file AND the resolved target must exist), so it can't
  manufacture a resolution absent on-disk evidence.
  Clears `import { describe, it, assert, contains } from 'utest'` (and the
  intra-package dotted names like `utest.mock.engine`).

- **NOT built — tier 3 (cross-package deploy-time siblings, e.g.
  `wifi-scripts/files/lib/netifd/wireless-device.uc` importing `./utils.uc`
  which really lives in `netifd/files/lib/netifd/utils.uc`).** Left as
  UC3002. A workspace-wide deploy-path index (mapping every `files/`/`root/`
  subtree's payload path to a repo file, then re-resolving relative imports
  against the DEPLOYED directory instead of the repo directory) is the right
  shape per the ticket's own tier-3 sketch, but it's a materially bigger,
  riskier piece of machinery (a NEW workspace-scan cache, ambiguity handling
  when two packages ship the same deploy path) than tiers 1/2's local,
  existence-gated ancestor probes — deferred rather than rushed into this
  pass. Verified still UC3002 after the fix (no accidental over-resolution).

Before/after (`--type-coverage`, this repo's real corpus):
- `utest/examples/unit/` (41 files): 15.5% (348/2248) → 71.4% (1604/2248),
  +1256 occurrences typed. Remaining 644 unknown are deeper body-inference
  limits (e.g. property-based generators, not resolution).
- `openwrt/.../wifi-scripts/files/usr/share/hostap/` (3 files): 60.1%
  (627/1044) → 63.1% (659/1044), +32. Smaller than the ~70-100 estimate
  because many hostap functions' bodies still don't infer a return type
  (untyped params, complex control flow) even once the import resolves —
  the RESOLUTION gap is fully closed; remaining unknowns are inference depth.

Tests: `tests/imports/test-deploy-root-module-resolution.test.js` (6 cases:
package-src-mirror bare + dotted resolution, a package WITHOUT the src/name.uc
marker staying unresolved, the hostap absolute-path case, the firewall4
sibling-root case via `require()`, and the cross-package-sibling case staying
UC3002). Existing `tests/imports/test-dotted-module-search-root.test.js` and
`tests/imports/test-file-resolver.test.js` re-verified green (no regression
to 0.7.48's mirror-root walk).

## The gap

The single biggest *user-function* unknown-return cluster in the audit is not an inference failure at
all — the **import never resolves**, so every symbol from the module (and every call's return type) is
`unknown`. Three deploy-layout shapes, all UC3002 today:

**1. Search-root mirror not named `share/ucode` (utest — ~500 occurrences).**
`utest/examples/unit/01_assertions_test.uc:1`:

```ucode
import { describe, it, assert, contains } from 'utest';   // UC3002: Cannot find module 'utest'
```

On-device the package installs to `/usr/share/ucode/` (`utest/src/utest.sh:3` — `UTEST_SRC=/usr/share/ucode`;
the runner also has `-l <path>` add-a-search-path). In the repo the root is **`utest/src/`**
(`utest/src/utest.uc` + `utest/src/utest/*.uc`). The resolver's ancestor walk
(`fileResolver.ts:689-706`) only recognizes directories literally ending `share/ucode` or `lib/ucode`,
so neither `'utest'` nor the intra-package dotted names (`utest.mock.engine`, imported by
`utest/src/utest/mock/global.uc`) resolve. Result: `it` (198), `describe` (49), `contains` (46),
`spy` (32), `truthy` (27), `prop` (25), `engine.get_registry` (19), and the long DSL tail all hover
`unknown` / no-hover.

**2. Absolute deploy path with a `files/` mirror (hostap — ~70 occurrences).**
`openwrt/package/network/config/wifi-scripts/files/usr/share/hostap/wdev.uc:3`:

```ucode
import { vlist_new, is_equal, wdev_set_mesh_params, wdev_remove, wdev_set_up, phy_open }
    from "/usr/share/hostap/common.uc";                    // UC3002
```

The target exists in the same package at
`openwrt/package/network/config/wifi-scripts/files/usr/share/hostap/common.uc` — i.e. under the
importer's own **`files/` deploy root** — but the absolute branch (`fileResolver.ts:637-646`) only
tries the literal path and `<workspaceRoot>/usr/share/hostap/…`. So `is_equal` (17), `wdev_remove`
(11), `phy_open` (10), `wdev_call` (12), `wdev_set_up` (5), `vlist_new` (8) etc. are unknown at every
call site in `wdev.uc` / `wifi-detect.uc`.

**3. Relative import between deploy-time siblings from different packages (~20 + heavy knock-on).**
`openwrt/package/network/config/wifi-scripts/files/lib/netifd/wireless-device.uc:4`:

```ucode
import { is_equal } from "./utils.uc";                     // UC3002
```

Both files install into `/lib/netifd/`: the importer from `wifi-scripts/files/lib/netifd/`, the target
from `netifd/files/lib/netifd/utils.uc` — siblings **only after deployment**, never in the repo.

## Root cause

`src/analysis/fileResolver.ts` `resolveImportPath` (~597-714) models exactly three root families:
importer-relative, workspace root, and ancestor dirs ending `share/ucode`/`lib/ucode` (the deliberate
"not any-ancestor" stance from `docs/done/ucode-module-resolution.md`). It has **no notion of a deploy
root**: (a) no way to declare a repo dir as a search root (`ucode -L` / `utest -l` equivalent), (b) the
absolute-path branch never maps `/<deploy-path>` onto an ancestor `files/` (or `root/`) directory, and
(c) relative resolution has no deploy-path index to find a cross-package sibling.

## Proposed approach

Three tiers, independent and individually shippable:

1. **`files/`-and-`root/` deploy-root mapping for absolute imports (cheap, sound).** In the absolute
   branch, after the literal and workspace-root probes fail, walk the importer's ancestors; for each
   ancestor named `files` or `root` (the OpenWrt package-payload convention — both occur in this
   workspace: `wifi-scripts/files/...`, `firewall4/root/...`), probe `<ancestor>/<absolute-path>`.
   Same-package only, no guessing across packages. Fixes case 2 outright.
2. **Configurable search roots.** A `ucode.moduleSearchPaths` LSP setting and/or a `.ucode-lsp.json`
   `searchPaths: ["src"]` at a package root (the same config file already planned for scope injection
   — `docs/call-scope-injection.md:127` — and host globals). Each entry is treated exactly like an
   installed root: bare/dotted names expand `<root>/<dots-to-slashes>.uc`. `utest/.ucode-lsp.json`
   with `{"searchPaths": ["src"]}` fixes case 1 for the whole repo. Optionally seed zero-config
   detection: a directory `X/src/X.uc` or `X/src/X/` matching the package name is a strong,
   verifiable signal — but keep auto-detection behind the same "provably resolves" bar as the existing
   mirror-root walk.
3. **Workspace deploy-path index for cross-package siblings (case 3 — optional, weakest).** Build a
   map deployPath → repo file from every `files/`/`root/` subtree (`…/files/lib/netifd/utils.uc` →
   `/lib/netifd/utils.uc`), compute the importer's own deploy path the same way, and resolve
   `./utils.uc` against the *deploy* directory when the repo-relative probe fails. Flag ambiguity
   (two packages shipping the same deploy path) as unresolved rather than picking one.

In all tiers, resolution success automatically restores the entire downstream pipeline (named-import
typing, cross-file return inference, hover, go-to-def) — no inference work needed. Existing behavior
must not regress: the strict importer-relative semantics for relative paths stay primary
(oracle-verified in `docs/done/ucode-module-resolution.md`); the new roots are fallbacks that only
fire when the faithful resolution fails, mirroring how the LSP cannot see deploy-time `-L` flags.

## Classification

**Tier 1 + 2: Solvable** — deterministic path mapping plus explicit configuration; no unsound
guessing (tier 1 stays within the importer's own package; tier 2 is user-declared, the direct analog
of the runtime's `-L`). **Tier 3: Partially solvable** — cross-package deploy merging is genuinely
ambiguous in the general case; the index approach handles the common one-provider case and refuses
ambiguity. Estimated impact: **~600 occurrences** (utest DSL ~500 — the largest single user-function
cluster in the audit; hostap ~70–100; netifd/wifi-scripts sibling ~20) plus large knock-on
de-propagation in every file that consumes these modules.
