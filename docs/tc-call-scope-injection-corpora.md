# call()-scope injection: two more real corpora beyond prometheus (luci dispatcher, openwrt cli)

Status: **NOT STARTED** (delta ticket). Filed 2026-07-07 from the --type-coverage audit.
The engine design already exists — `docs/call-scope-injection.md` (investigated, not
implemented). This ticket records the NEW corpora + counts the audit surfaced, which roughly
double the measured impact and confirm the existing design generalizes. Implementation should
follow that doc; nothing here changes its architecture.

## The gap (new evidence)

The audit's no-hover population attributable to `call(fn, ctx, scope)` injection:

| corpus | occurrences | injected names |
|---|---|---|
| prometheus-node-exporter (the doc's original corpus; owned by another ticket) | 144 | gauge, counter, oneline, wsplit, nextline, fs, ubus, config, poneline |
| **luci controllers** (NEW) | **107** | http (72), ctx (11), dispatcher (5), ubus (12), uci (4), config (1), … |
| **openwrt cli framework + its module ecosystem** (NEW) | **49** | model (45), ctx (1), … |
| user project `payload_processor_ucode` (NEW, minor) | 2 | EdgeDeviceWhitelist |

Sample sites:

```
luci/modules/luci-base/ucode/controller/admin/index.uc:125   if (reqlang != dispatcher.lang)        // no hover
luci/applications/luci-app-dockerman/ucode/controller/docker.uc — 24× http.*                        // no hover
openwrt/package/utils/cli/files/usr/share/ucode/cli/modules/network.uc:9   model.add_nodes(...)     // no hover
openwrt/package/network/services/unetd/files/unet.uc — 20× model.*                                   // no hover
```

## Root cause (verified in the corpus sources)

Same unimplemented mechanism as the doc; the binding sites are:

- **luci**: `luci/modules/luci-base/ucode/dispatcher.uc:834` —
  `call(mod[action.function], mod, runtime.env, …)`. The scope is `runtime.env`, built at
  `dispatcher.uc:893-935` from an object literal: `{ http, ubus, uci, ctx: {}, config,
  dispatcher: { build_url, is_authenticated, menu_json, … }, striptags, entityencode, _, N_ }`
  (plus `runtime.env.ctx = resolved.ctx` per request). Every
  `luci/*/ucode/controller/**/*.uc` action body reads these as free globals.
- **openwrt cli**: `openwrt/package/utils/cli/files/usr/share/ucode/cli/datamodel.uc:97-101` —
  `let fn = loadfile(path, …); mod = call(fn, this, this.scope)` with
  `this.scope = proto({ model }, global)` (`datamodel.uc:172`). The loaded "cli modules" —
  including OUT-OF-PACKAGE ones like `unetd/files/unet.uc` and `umdns/files/mdns.uc` — read
  `model` as a free global. This is EXACTLY the doc's `loadfile → call` idiom, with the twist
  that the scope is a `proto({…}, global)` call rather than a bare object literal (the Layer-1
  shape extractor must look through `proto(obj, global)`).
- **payload_processor**: host-injected PascalCase globals (`EdgeDeviceWhitelist`). Noteworthy
  only because the hover fallback for assumed injected globals is SCREAMING_SNAKE-gated
  (`src/hover.ts:1516`, `/^[A-Z][A-Z0-9_]*$/`) so PascalCase injected names get silence instead
  of the "(injected global, assumed)" explainer.

## Proposed approach

Implement `docs/call-scope-injection.md` as designed (Layer 1 shape extraction + Layer 2c
`.ucode-lsp.json` association + 2a ⊆-gated auto). Deltas this corpus adds to that plan:

1. **Scope-shape extraction must handle**: `proto(objLiteral, global)` (cli), an env object
   built incrementally across statements (`runtime.env.ctx = …` after construction, luci), and
   scope objects passed through a constructor call (`LuCIRuntime({...})` → `runtime.env`).
   Start with the object-literal core and the `proto(…, global)` unwrap; the luci runtime.env
   may need the 2c config escape hatch initially.
2. **Association candidates for 2a's ⊆ check**: luci controllers are discoverable by path
   convention (`ucode/controller/**/*.uc` under a tree whose dispatcher.uc exists); cli modules
   by the `cli/modules/*.uc` convention plus the cross-package `usr/share/ucode/cli/modules`
   install dir. Both fit the doc's "directory heuristic + subset gate".
3. **Cheap independent win**: relax the SCREAMING_SNAKE-only gate on the "(injected global,
   assumed)" hover to also cover PascalCase names that carry a JSDoc `@global` or appear in an
   `if (!Name)` existence-guard pattern — or at minimum document the gate. (2 occurrences;
   UX-only.)

## Classification

**Partially solvable** (per the existing doc: shape = solvable, association = config-assisted).
107 + 49 + 2 = **158 new occurrences** on top of the doc's 144 (prometheus, owned elsewhere).
No new mechanism — this is corpus/priority evidence for implementing the existing design, with
two concrete extractor extensions (`proto(…, global)`, incremental env construction).
