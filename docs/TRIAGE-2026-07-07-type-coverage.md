# Triage: the --type-coverage audit (2026-07-07)

Source: `ucode-lsp --type-coverage` (added 0.7.68) over the full vendored corpus — **31,445 findings**
(29,458 unknown-type + 1,987 no-hover) across **80,031 probed variable occurrences** in **497 files**
(60.7% typed). Findings were clustered mechanically by syntactic context, then six agents root-caused
each slice against the corpus source, `src/analysis/`, and the vendored ucode C source. Every distinct
new issue has a ticket at `docs/tc-*.md` (26 filed); issues already covered by existing docs are
referenced, not re-filed.

**Read the counts with care.** Occurrences ≠ problems: one untyped seed poisons every downstream
read, so buckets overlap by design. The propagation structure is the point — fixing the seeds
collapses the tail. Roughly 75–80% of the "derived" signatures (for-in vars, assign targets, plain
reads) are pure downstream propagation of the four seed families below.

---

## Bucket 1 — Solvable (bugs and mechanical gaps; ~2,000 direct occurrences, plus large indirect recovery)

Ordered by recommended priority.

| Ticket | What | Direct occ. |
|---|---|---|
| `tc-analyzer-crash-inferredparams-scoperole.md` | **Whole-file analysis death**: `X = { f: function(a){…} }` → taint walk hits stamped `_inferredParams` → SCOPE_ROLE TypeError. Kills ALL diagnostics for the file, not just hover. Minimal repro in ticket. | 36 (+ every other diagnostic in affected files) |
| `tc-analyzer-crash-moduletype-argtype.md` | **Whole-file analysis death**: `type(hostapd)` / `type(require("fs"))` → ModuleType object reaches `argType.includes` → TypeError. | 10 (same amplifier) |
| `tc-falsy-branch-narrow-to-unknown.md` | **Biggest single inference bug found**: inside functions, reads after `if (v) …` in the falsy path hover `unknown` for boolean/integer/string vars — empty falsy-narrowing is encoded as UNKNOWN (lattice TOP) and `joinTypes` absorbs it at the merge. Systematic corpus-wide; a large share of what was attributed to "propagation" is actually this. Localized fix (bottom/never + falsy-capable narrowing). | order 10²–10³ (hidden inside other buckets) |
| `tc-module-search-roots-deploy-layout.md` + `tc-module-root-mapping.md` | Import roots that exist only at deploy time (utest `src/`→`/usr/share/ucode`, hostap absolute paths, in-package `root/usr/share/ucode` siblings). Resolution failure — fixing it re-enables the whole existing cross-file inference pipeline for those projects. | ~600 |
| `tc-forin-two-var-key-type.md` | `for (k, v in x)`: the KEY var is provably `string \| integer` per vm.c even over a fully unknown iterable. (0.6.189 fixed value vars, missed keys.) Independent of all upstream causes. | ~544 |
| `tc-compound-assign-operator-typing.md` | Compound assignment is operator-blind (`x op= y` typed as bare RHS). Includes **silent wrong types**, not just unknowns: `s += 1` on a string hovers `integer`; `??=` drops the left type. | ~296 (46 flagged) |
| `tc-fn-reference-property-returns.md` | Object properties holding function *references* (`select: context_select`, `o.append = function…`) carry no return type; only inline FunctionExpressions do. | ~150 |
| `tc-this-method-forward-ref-return.md` | `this.method()` called before the sibling's definition gets the shallow pre-pass return type; the accurate type exists at literal-exit but is never back-filled. | ~100–120 |
| `tc-json-any-return-display.md` | `json()` returns any JSON value by contract (lib.c); today that's `UNKNOWN`. Proposes an `ANY` sentinel: behaves as unknown in checks, displays honestly, counts as typed. Design decision. | ~110 |
| `tc-arith-unknown-operand-numeric.md` | `- * / % **` and unary ops ALWAYS yield integer/double per vm.c (only binary `+` concats) — `u - 1` on unknown is soundly `integer \| double`. | ~100 |
| `tc-inline-require-member-call.md` | `require('ubus').connect().call(…)` chained on the inline require loses the module type (works via intermediate variable). Missing MODULE_REGISTRIES branch in the chained-receiver path. | ~45 |
| `tc-barrel-reexport-typing.md` | Barrel re-exports (`export const mock = _mock`) drop all typing — fileResolver ignores initializers of exported consts. | ~120 (utest) |
| `tc-unary-operator-union-collapse.md` | Unary `+`/`-`/`~` collapse any union operand to unknown (binary ops distribute; unary never got it). | ~22+ |

Also solvable, already ticketed elsewhere: uci section shapes (`docs/done/130/131`, ~117 occ) if not yet fully landed.

## Bucket 2 — Partially solvable (inference/ambient/config work; the bulk of potential recovery, ~8–12k realistic)

| Ticket | What | Potential occ. |
|---|---|---|
| `tc-callsite-param-inference-local.md` | **The keystone.** Type unannotated params of non-escaping file-local functions as the union of concrete arg types at all call sites. Sound (call-site args ≠ the banned body-usage inference); strict "every visible arg concrete" gate. Fixing param decls fixes the 2:1 downstream read tail for free. | ~4–5k of the 16.8k param family |
| `tc-callsite-param-inference-crossfile.md` | Same mechanism across files for exported functions (reverse of the existing importer-side call checking) + object-literal methods. | ~3k more |
| `tc-object-param-member-shape.md` | Object-shape counterpart: propagate *object literal shapes* through call sites so `p.field`/`p[k]` on object params resolves. `@param {Typedef}` already works — the corpus just doesn't annotate. | ~2.4k (overlaps above) |
| `tc-template-render-scope-hover.md` | firewall4-style `include()`d templates: render-scope names (`fw4`, `rule`, `zone`) get no hover; CLI never builds the include-scope index (audit-fidelity gap) and hover has no render-scope fallback. | 1,176 |
| `tc-call-scope-injection-corpora.md` | Delta over `docs/call-scope-injection.md`: luci dispatcher `runtime.env`, openwrt-cli `model.scope`, user PascalCase injected globals. | ~300 (156 more under the existing prometheus doc) |
| `tc-ubus-request-handler-ambient.md` | `req` in ubus method/subscriber handlers has a fixed C-defined shape (`ucode/lib/ubus.c`): `args`/`info`/`type` + `reply/error/defer`. Same pattern as the uhttpd ambient. `req.args` *values* partially recoverable from the sibling `args:` schema. | ~266 |
| `tc-cross-file-global-property.md` | `global.X` property types are same-file only; import-linked setters auto-solvable, `ucode -l` preloads need config. | ~190 |
| `tc-require-user-module-typing.md` | `require("user_module")` never routes through the fileResolver/export machinery (builtin-only today, explicit TODO). Needs root mapping above for firewall4. | ~75 recoverable |
| `tc-utest-mock-proxy-typing.md` | Framework rule: `mock.global.patch('fs', …)` returns module-shaped proxies. | ~100 |
| `tc-include-deploy-path-mapping.md` | `include("templates/x.uc")` resolvable only in deploy layout; sibling-basename heuristic + config map. | 45 |
| `tc-strict-equality-literal-narrowing.md` | `x === "lit"` provably narrows (strict equality can't coerce; `==` excluded). | small |
| `tc-uhttpd-ambient-nonhandler-module.md` | uhttpd ambient gated to template+handler misses handler-support modules. | 2 |

## Bucket 3 — Un-solvable (honest unknowns; ~5–7k)

No tickets — these are correct behavior. Mitigations exist but are user-side (JSDoc, `@global`,
`.ucode-lsp.json` associations) or already-documented decisions.

- **Host-invoked callback params** (~2.5–3.4k): `global.handle_request = function(env)`,
  ubus/uloop/netifd handlers — no visible caller ever passes the argument. Escape hatch:
  `docs/planned-type-inference-todos.md` §5, `docs/planned-runtime-introspection.md`.
- **Transitive unknown chains** (~2.5–3.4k): `mac_parse(mac)` where `mac` is itself an unknown
  param; functions passed as values. The "any-unknown-arg ⇒ stay unknown" soundness gate is
  deliberate. Shrinks as Bucket 2 seeds resolve, never to zero.
- **RPC/kernel payload members** (~150–250): `ubus.call(…).x`, `nl80211.request(…)[k]` — open
  by design. (`ubus.call`'s `object | null` registry type is correct and working.)
- **Open-world templates** (209): documented no-auto-suppress decision
  (`docs/done/ucode-template-mode-support.md`); `mangle-rule.uc` additionally has a genuine
  upstream syntax error (dead file upstream).
- **Dynamic module/include args** (~35): `require(action.module)`, `include(fs.glob(...)[i])`.
- **True positives + own-repo noise** (175): 8 real upstream bugs correctly flagged (unetacl,
  cli, wifi-scripts, a luci `undefined` JS-ism); the rest are intentionally-broken fixtures and
  local experiment edits in this repo.

Display-level footnote: `T | unknown` unions rendering as-is is deliberate for now —
`docs/auto-docs/113-union-with-unknown-not-collapsed.md` (needs a product decision, interacts
with `tc-json-any-return-display.md`).

---

## Recommended order of attack

1. **The two analyzer crashes** — they silently disable every diagnostic in affected files; small fixes.
2. **`tc-falsy-branch-narrow-to-unknown`** — one localized lattice fix, corpus-wide recovery of
   already-known types.
3. **Deploy-layout module roots** — pure resolution work that re-arms existing inference for whole
   projects (utest, hostap, firewall4-via-require).
4. **The mechanical inference wins** (for-in keys, compound assign, arith-on-unknown, fn-reference
   returns, this-forward-ref, inline-require chains, barrel re-exports, unary unions).
5. **Call-site param inference, local first** — the keystone; its escape/collection core is then
   reused by the cross-file and object-shape tickets.
6. **Ambients/config** (ubus `req`, render-scope hover, scope-injection corpora, global-property
   cross-file) as appetite allows.

Falsification notes from the sweep (so nobody re-chases them): the template colon/`endif`
alternative syntax parses fine (since 0.7.0) — the firewall4 no-hovers are render-scope injection,
not parsing; `argv[0]` findings are a param named `argv`, not the `ARGV` global; `catch`-param
typing has zero findings; `let x;` flow pickup has zero genuine findings (that cluster was for-in
keys misfiled by the clustering regex); the `apply_mask` cluster was shadowed filter-callback
params, not a return-type failure.
