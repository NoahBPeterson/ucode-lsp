# 0.9.0: deep uci usability — beyond type in/out

Status: **NOT STARTED — user-requested next major ticket (2026-08-05).** Goal per the
request: "encapsulate the maximum-possible amount of usability, error diagnostics,
warnings, autocompletion — everything possible", because today we only capture type
input/output uncertainty and basic arity/type errors on the uci module.

Ground truth available in-repo:
- `uci/` — the vendored libuci checkout (libuci.c/file.c/parse.c/delta.c: the REAL
  option/section/package name rules, error codes, delta/commit semantics).
- `ucode/lib/uci.c` — the ucode binding (cursor methods' actual C behavior: what
  returns null vs error string vs dies; `.error()` pairing).
- The owrt-{2203,2305,2410,2512,main} containers — live oracles for per-release
  behavior and real /etc/config corpora.
- Every corpus (glinet, fw4, luci, standalone repos) is FULL of real uci call sites
  to mine for idiom patterns and FP-risk assessment.

Candidate feature families (to be triaged into the ticket proper; each needs the
usual oracle verification before build):

1. **Config-name / section-type / option literal intelligence.**
   - Validate name lexemes against libuci's parser rules (parse.c: valid package/
     section/option identifier charsets; `uci_validate_name`).
   - Workspace awareness of /etc/config shapes: when a corpus/package ships
     `root/etc/config/<name>`, learn its section types + option names → completion
     for `uci.get('<pkg>', …)` arguments, warnings for unknown packages/options
     (evidence-gated like the LuCI work — only claim what the tree ships).
   - `uci_defaults` scripts and `config` file syntax awareness (sh/uci.sh dialect?
     probably out of scope — note explicitly).
2. **Cursor lifecycle + state diagnostics.**
   - `cursor()` nullability guard nudges (already an error today; add quick fix).
   - load/commit/save/revert pairing: flag `set`/`add`/`delete` with no reachable
     `commit` on the same cursor (lint, warning tier); `unload` after commit hints.
   - `.error()` pairing after a null return (the binding's error-reporting idiom).
3. **Return-shape precision per method** (from ucode/lib/uci.c, per release):
   - `get` vs `get_all` vs `get_first` result shapes incl. list-vs-string option
     duality (the classic uci footgun — an option that is a list returns array);
     `foreach` callback param typing (section object incl. `.type`/`.name`
     dot-metadata); `add` returning the generated section id string; `changes`
     shape; `configs` listing.
4. **Argument-position completion**: known config names (from workspace /etc/config
   + the standard set per release container), section types, common option names —
   the `constantPrefixes` machinery generalized to evidence-backed string sets.
5. **Idiom lints from real-world corpus mining**: e.g. `uci.get(a, b)` 2-arg form
   returning section TYPE not option; `set` with array value vs `list` semantics;
   quoting/type coercion of option values (everything is strings on disk).

Explicitly NOT version-gate-free: the uci ucode binding evolved across releases
(list_append/list_remove landed 24.10 — already gated). Every new method-level fact
needs the per-pin extraction treatment (`git -C ucode show '<pin>:lib/uci.c'`).

Approach note: follow the 0.7.67 ticket-sweep/0.8.0 methodology — oracle first
(containers + vendored C), corpus differential before/after every family, and the
evidence-gate philosophy for anything workspace-shaped.
