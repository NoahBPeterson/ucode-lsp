# Bundled luci-base reference modules

Reference copies of the LuCI ucode runtime modules (`luci.sys`, `luci.http`,
`luci.dispatcher`, `luci.runtime`, `luci.zoneinfo`, `luci.authplugins`,
`luci.luciplugins`, `luci.uhttpd`) plus the base template tree, taken from the
LuCI source tree (https://github.com/openwrt/luci, `modules/luci-base/ucode/`,
snapshot of the main branch — see `ucode-upstream.json` pinning conventions).
LuCI is licensed Apache-2.0; see its LICENSE/NOTICE.

Purpose: a **standalone** LuCI package (a Makefile with `LUCI_TITLE`/luci.mk,
developed outside the LuCI checkout) imports these modules from the device at
runtime, so nothing on disk describes their exports. `resolveLuciModulePath`
falls back to this directory when workspace resolution fails, giving such
packages real cross-file types, signature help, member validation, and
go-to-definition. Inside a full LuCI checkout the tree's own files always win.

Two files are NOT copies:
- `core.uc` — hand-authored type stub for the native `luci.core` C module
  (mirrors `modules/luci-base/src/lib/luci.c` exactly; bodies encode return types).
- `version.uc` — hand-authored stub for the build-generated version module
  (exports `revision` and `branch`, mirrored from consumer usage).

When refreshing from a newer LuCI: re-copy the `.uc` modules and `template/`,
keep the two stubs, and re-verify `core.uc` against `src/lib/luci.c`.
