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
