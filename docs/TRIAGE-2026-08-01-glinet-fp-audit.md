# TRIAGE 2026-08-01 — glinet-ucode audit follow-up (325-diagnostic report)

A separate Claude session audited `~/Downloads/sft1200-fw/glinet-ucode` (55 files, 325
diagnostics) and classified ~70 diagnostics as LSP false positives. This triage re-verified
every claimed class against our CLI (0.7.77) + real ucode (old local binary AND a master
`81205a2` build). Each confirmed class has its own ticket; **two of the audit's headline
"false positive" classes turned out to be TRUE POSITIVES** (the audit verified compile,
not runtime).

## Corrections to the audit (important)

1. **UC1009 "use before declaration" ×6 (dpi.uc:55, repeater.uc:195, cable.uc) — the audit
   called these FPs ("uses inside functions that only run after module load — valid ucode").
   WRONG: verified `function a() { return b(); } function b() {…} print(a());` crashes
   "Type error: left-hand side is not a function" on old ucode AND master, top-level and
   nested, strict ("Reference error") and non-strict.** The forward reference inside `a`
   compiles as a GLOBAL lookup; the later `function b()` declares a module-LOCAL — they
   never connect, no matter when `a()` is called. `ucode -c` compiling clean proves nothing.
   So glinet has REAL latent crashes: `dpi.uc` `today()` and `repeater.uc`
   `get_current_repeater_network()` will throw whenever invoked. Our diagnostic and its
   "Move its declaration above this use" remedy are correct as-is.
2. **"Null deref via out-of-bounds array index passes silently" — wrong.** `arr[10].foo` on a
   1-element literal gets UC5006 "may be null" (warning). Real ucode crashes, so a severity
   upgrade for a CONSTANT index beyond a KNOWN-length literal is optional polish, but it is
   not undetected.

## Confirmed LSP bugs (tickets filed)

| class | audit count | ticket | repro status |
|---|---|---|---|
| `from` rejected as identifier (parser) | 33 (1 parse fail + cascade) | [from-contextual-keyword.md](from-contextual-keyword.md) | minimal repro confirmed |
| Regex "Unbalanced parenthesis" on `\/` and `[^\]]` | 2 | [regex-escaped-class-unbalanced-paren-fp.md](regex-escaped-class-unbalanced-paren-fp.md) | confirmed, both regexes run fine in real ucode |
| branch-reassigned uninitialized `let` resurrects declared null → UC2009 | ~14 (repeater/firewall/vpn-client) | [uc2009-branch-reassign-declared-null.md](uc2009-branch-reassign-declared-null.md) (replaces the disproven `?? {}` theory) | trigger matrix verified: `let x;` + assign + then-branch reassign |
| uci `foreach` callback `let` locals resolve to BUILTINS | part of the 14 (lan.uc proto→`function`) | [foreach-callback-local-builtin-shadow.md](foreach-callback-local-builtin-shadow.md) | minimal repro confirmed |
| `type(x)` alias narrowing inverted after early return | 2 (firewall.uc:88,110) | [type-alias-early-return-inverted-narrowing.md](type-alias-early-return-inverted-narrowing.md) | minimal repro confirmed |
| `type(x)=="object"` fails to narrow string\|object\|null fn-return union | 3 (cloud.uc UC5003) | [type-guard-object-union-narrowing-fp.md](type-guard-object-union-narrowing-fp.md) | confirmed on real file |

## Enhancements / reports (tickets filed)

- **User-defined boolean guards** (`if (!check_resp_data(r) || …) return;` should narrow `r`) —
  ~10 nullable diags in upgrade.uc → [user-defined-guard-narrowing.md](user-defined-guard-narrowing.md).
- **Stale workspace diagnostics**: audit reported the project-wide scan served diagnostics for a
  PRIOR commit's `tailscale.uc` content until the file was individually rechecked (328→325).
  Not reproduced here (no repro steps for the git state) → [workspace-stale-diagnostics-report.md](workspace-stale-diagnostics-report.md).
- **Detection gaps probed and confirmed**: too-few args to user functions (`two(1)` silent);
  statement after `return` inside a function not flagged despite UC4001 existing; `if (x = 5)`
  assignment-in-condition silent → [glinet-detection-gaps.md](glinet-detection-gaps.md).

## Audit claims accepted without new tickets

- igmp.uc:65 swapped `join(kept, "\n")` — true positive of ours, real bug in glinet (they fixed).
- The ~241 "unknown"/nullable strictness errors on uci/ubus/popen data — by design
  (`strictUnknownArguments`); the ubus-request ambient-typing work (docs/tc-ubus-request-handler-ambient.md)
  and scope-injection corpora are the long-term fix for their volume.
- 14 warnings (unused vars, builtin shadowing, `==` coercion advisories) — accurate per audit.

---

## Resolution (2026-08-09, 0.8.6): the "13 remaining FPs" adjudicated and fixed

A follow-up audit round (post-0.8.5) listed 14 remaining FPs. Verdicts:

**NOT false positives (7)** — UC1009 forward references (cable.uc:656-663 ×4,
dpi.uc:55, repeater.uc:195, wg_client.uc:126). Re-verified against BOTH OpenWrt
containers (ucode main pin and 25.12): a reference compiled before the
declaration resolves as a global lookup while a later top-level `function`
statement creates a scoped LOCAL, so even DEFERRED calls die with "left-hand
side is not a function". cable.uc's own "kept at bottom: referenced by
set_config" comment documents a belief that is false — `set_config` with
`proto == "static"` crashes at runtime. Second time this audit class has been
debunked; the flags stay.

**Real FPs — three engine bugs fixed in 0.8.6:**

1. **Combined-OR negation inversion** (firewall.uc 88/110 "got integer |
   double"): `applyTypeGuard` IGNORED `isNegative` on `isCombinedOr` guards, so
   the fall-through of `if (t == "int" || t == "double") return …` narrowed the
   variable TO integer|double. Now removes the union members on the negative
   edge.
2. **UC5003 through a `type(x) == "object"` guard** (cloud.uc 112/113/137): the
   member-access string check read the RAW union (`object|string|null` from
   switch_server_format's dict-value/for-in-key/null returns) instead of the
   guard-narrowed type. Now consults getNarrowedTypeAtPosition like the
   provably-null check beside it.
3. **Union-of-tuples indexing took the FIRST array member only** (vpn-client.uc
   567/568 UC2009): `split_host_port`'s three tuple arms union to
   `array<null> | array<string|null>`; `hp[0]` typed bare `null` → the
   `domain != ""` comparison "always true". Now unions ALL array members'
   element types (unknown members RETAINED — no over-claim).

Plus: `A || B` now applies A's NEGATED type guard inside B (`t != "string" ||
match(v, …)` proves v string), mirroring the else-branch flip — this also
removed four strict-unknown FPs (firewall.uc:88, black_white_list.uc:120,
dns.uc:313, macclone.uc:39, timer.uc:27) beyond the audited list, and made the
old "OR does not narrow" test assertion obsolete (it was pinning the gap).

Residual (accepted): firewall.uc:110 now shows the honest strict-unknown
complaint instead of the wrong-type claim — full `string` narrowing there needs
negation of a disjunctive arm (`port == null || (t != "s" && t != "i" && …)`),
filed as a follow-up thought, low value while strictUnknownArguments already
covers the file.

Validation: mega-sweep 282 files / 93,238 lines vs 0.8.5 → **−15 / +4**, all
adjudicated (removals = the FP classes + short-circuit wins; adds = more-honest
message rewrites on persisting warnings). Tests:
tests/test-guard-negation-fixes.test.js (10). Suites 4,450/0 + comprehensive.
