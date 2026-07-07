# Module resolution misses deploy-layout roots — utest `src/`, hostap absolute imports, cross-package siblings

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

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
