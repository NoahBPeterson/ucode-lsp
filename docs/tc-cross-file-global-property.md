# `global.X` assigned in one file, read in another — property types don't cross files

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

`global.X = …` typing is same-file only (0.6.194/0.7.x work). When the assignment lives in a
different file, readers get `unknown` (or worse, only name-suppression without types). Two link
shapes in the corpus:

**A. The setter is an imported module (syntactic link exists — solvable automatically).**

```ucode
// openwrt/.../wifi-scripts/files-ucode/usr/share/ucode/wifi/common.uc:7
global.ubus = libubus.connect();
// hostapd.uc:3-6 imports from 'wifi.common', then:
let status = global.ubus.call('network.wireless', 'status');   // unknown (hostapd.uc:68)
let ret = global.ubus.call('hostapd', 'config_set', msg);       // unknown (:601), ret.pid unknown (:604)
```

Importing a module *executes* it, so its `global.X` side effects provably apply in the importer.
Verified repro: two files, `common.uc` sets `global.ubus = connect()` and exports a function;
`user.uc` imports it — `global.ubus.call(…)` result is `unknown` (would be `object | null` same-file).

**B. The setter is preloaded externally (`ucode -l mocklib`) — association is outside the source.**

```ucode
// adblock-fast/tests/lib/mocklib.uc:175  (also firewall4/mwan4/pbr/openwrt-firewall4 copies)
global.mocklib = { read_json_file: …, trace_call: …, capture: … };  // :242 return global.mocklib;
// adblock-fast/tests/lib/mocklib/ubus.uc:4  — NO import/include of mocklib.uc anywhere
let mocklib = global.mocklib; // ucode-lsp disable
mock = mocklib.read_json_file(path);          // mocklib: unknown ×137
```

The link is `run_tests.sh:229` (`ucode … -l mocklib …`) — a shell script, invisible to the analyzer.
Same shape: `global.__utest_mock_instance` (set in utest's mock module, read in
`utest/src/utest/runner/worker/runner.uc:55` — 6 findings).

Audit occurrences: `global.mocklib` clusters 137+16, `global.ubus.call` 4+3, `__utest_mock_instance`
5+1 → **~166**, plus member reads off the results.

## Root cause

- `collectGlobalPropertyNames` (`src/analysis/semanticAnalyzer.ts:2383`, shared with the checker via
  `setGlobalPropertyNames` :546) scans only the CURRENT file's AST; `global`'s
  `propertyTypes` map is per-analysis.
- The cross-file machinery that DOES exist covers a different edge: `collectLoadfileGlobals`
  (semanticAnalyzer.ts:2238-2255) merges globals injected by `loadfile("<literal>")()` targets via
  `fileResolver.getLoadfileGlobals` (fileResolver.ts:228) — including object property shapes
  (`forceGlobalDeclaration` + propertyTypes). **Import edges and external preloads never take this
  path.**

## Proposed approach

1. **Shape A (auto):** when a file imports module M (any specifier form), run the same
   global-property extraction `getLoadfileGlobals` performs over M's AST (it already parses M for
   exports — piggyback on the resolver cache) and merge the results exactly like
   `collectLoadfileGlobals` does: suppress UC1001, declare object-valued globals with their member
   shapes, carry value types. Transitive through M's own imports with the usual depth/cycle guards.
   This alone clears `global.ubus` in the wifi scripts (7 findings + members like `.pid`).

2. **Shape B (config):** an explicit preload list in the `.ucode-lsp.json` project config proposed by
   `docs/call-scope-injection.md` Layer 2c / `docs/tc-module-root-mapping.md`:
   ```json
   { "preload": ["tests/lib/mocklib.uc"], "appliesTo": ["tests/**/*.uc"] }
   ```
   Files matching `appliesTo` get the preloaded file's `global.X` bindings (again reusing the
   getLoadfileGlobals extraction). Mirrors `ucode -l` semantics one-to-one. The existing
   `// ucode-lsp disable` escape hatch in the corpus shows users are already suppressing this noise
   by hand — the config turns suppression into typing.

Soundness note: only merge from ROOT-reachable setters (imports/preloads actually executed), not
from any file in the workspace that happens to assign `global.X` — a workspace-wide "someone set it"
scan would type bindings that don't exist at runtime for a given entry point.

## Classification

**Partially solvable** — Shape A fully automatic; Shape B needs one config line per test-suite
(association is genuinely external, same argument as call-scope-injection Layer 2). **~166 direct
occurrences** + downstream member reads (mocklib method results feed the 1,863-finding mocklib file
population's cross-file portion).
