# Cyclic prototype chain: a missing-member read HANGS the ucode VM

Status: **LINT BUILT — UC8016, same 0.8.11 round (uncommitted, awaiting user
test).** Interpreter finding container-proven 2026-08-15 while oracle-verifying
the proto() demo; upstream report still worth filing.

## As built

`detectProtoCycles` (protoResolver.ts): edges V → P from every `proto(V, P)`,
LAST call per source wins (runtime REPLACE semantics — a transient cycle broken
by a later re-parent is NOT flagged), functional-graph chain walk, each cycle
reported once. `checkCyclicPrototypeChains` (semanticAnalyzer, whole-file pass
alongside UC8010) flags EVERY call closing the cycle, severity **Warning**:

> (completing call) This proto() call creates a prototype cycle (A → B → A).
> Reading any member that exists nowhere on the chain makes the program hang
> forever.
> (earlier calls) A later proto() call turns this prototype chain into a
> cycle (A → B → A). Reading any member …

**Graph shapes (one prototype slot per value ⇒ out-degree ≤ 1):** the proto
graph is a functional graph, so each component holds AT MOST ONE cycle —
"two cycles sharing a node" is unconstructible, and joining two cycles with a
proto() call REPLACES an edge, turning one cycle into the other's tail. The
general hazardous shape is the ρ (tortoise-and-hare): a tail a→b→c running
into a cycle d→e→f→g→d. Handled in full: warnings sit on the CYCLE edges
only (tail edges are legal chains); proven-read ERRORS cover cycle members,
tail nodes ("…runs into the cycle…" message variant), and instances attached
to either — with members found mid-tail correctly exempt (first hit
terminates the walk; tail hang and mid-tail safety both container-proven).

No valid use case exists for a cycle: the lookup walk stops at its first hit,
so the back-edge can only re-visit tables the walk already saw — it resolves
nothing a linear chain of the same tables wouldn't, and only converts
"missing → null" into "missing → hang". Corpus check 2026-08-16: all 8
two-arg proto() sites in the vendored trees are linear chains or
shared-parent trees (`proto(ret, proto(this))`); zero cycles.

**ESCALATION (same round): a PROVEN hang read is an ERROR** at the read site —
emitted only when every step is certain: all closing calls unconditional at top
level, every participant table (and the instance's own literal) fully static,
the read unconditional at top level after closure, and the member absent from
the entire chain. Exemptions, each container-proven: writes (`ucv_key_set` is
own-member only), deletes, pre-closure reads (null, not a hang), and anything
inside a function/if/&&/ternary (not provably executed). Message:

> Reading 'x' hangs the program forever — it exists nowhere on the cyclic
> prototype chain A → B → A, so the lookup never ends.

24 tests (6 unit, 18 e2e: self-loop, 3-cycle, linear/broken-cycle negatives,
disable-directive, and the full escalation matrix — instance/participant/
method-call positives, write/delete/pre-closure/guarded/spread/conditional-
closure/opaque-instance exemptions). Corpus: zero hits in 284 files. Demo §9
shows warning AND error live.

## The finding

`ucv_key_get` (vendored ucode/types.c) walks the prototype chain with no cycle
guard. A cycle is trivially constructible — `ucv_prototype_set` doesn't check:

```ucode
const A = { am_fn: function() { return "a"; } };
const B = { bm_fn: function() { return "b"; } };
proto(A, B);
proto(B, A);            // accepted — no error
let cy = proto({ own: 1 }, A);

cy.am_fn();             // "a"  — fine
cy.bm_fn();             // "b"  — fine (found one level up)
cy.own;                 // 1    — fine
cy.does_not_exist;      // INFINITE LOOP — 100% CPU, forever
```

Verified on owrt-main (2026-08-15), twice, isolated: the identical script minus
the missing-member read completes instantly; with it, the container spins until
killed. A **present** member terminates the walk at its first hit, so a cyclic
program can run correctly for years until the first typo'd or optional member
read — then it hangs the process, not even a crash loop for procd to restart
cleanly (the process never exits).

## Proposed lint

We already collect every `proto(V, P)` site (`src/analysis/protoResolver.ts`).
Detect a cycle among re-parented names/tables — `proto(A, B)` + `proto(B, A)`
(any chain length, symbol-level approximation) — and flag BOTH sites:

> "These proto() calls create a cyclic prototype chain. Reading any member that
> does not exist on it makes the program hang forever."

Severity: **warning** at minimum (the program may be correct today), arguably
error — there is no legitimate use for a cyclic chain, since every reachable
member is already reachable without the back-edge.

Grokable-diagnostics rules apply; no quick fix is obviously right (which edge
to cut is the author's call).

## Notes

- The LSP itself is safe: `protoLayerShape` merges through SYMBOL maps (no
  chain walk), `effectiveMembers` is depth-capped at 8, and the e2e suite pins
  cyclic completion terminating (`test-proto-first-class.test.js` "CYCLIC
  re-parenting terminates").

## Upstream issue — ready to file at https://github.com/jow-/ucode/issues

Title: **Cyclic prototype chains are constructible, and looking up a missing
member on one hangs the VM in an unbreakable infinite loop**

---

Minimum reproducible example (verified on current main):

```sh
$ ucode -e 'let o = {}; proto(o, o); o.x;'
# never returns — 100% CPU until killed externally
```

Control showing the set itself is accepted and only the missing READ hangs:

```sh
$ ucode -e 'let o = {}; proto(o, o); print("ok\n");'
ok
$ echo $?
0
```

`ucv_prototype_set()` (types.c) assigns `->proto` without checking whether the
new prototype's own chain already contains the target — the self-reference
above, or mutually via two objects:

```ucode
const A = { am: 1 };
const B = { bm: 2 };
proto(A, B);
proto(B, A);   // accepted — A and B are now each other's ancestors
```

Both member-lookup walks are unguarded:

- `ucv_key_get()`: `for (o = scope; o; o = ucv_prototype_get(o))`
- `ucv_property_get()`: `for (; uv; uv = ucv_prototype_get(uv))`

A lookup that FINDS a member terminates at its first hit, so a cyclic program
runs normally — until the first read of a member that exists nowhere on the
chain, which then loops forever at 100% CPU:

```ucode
A.am;              // 1   — fine
A.bm;              // 2   — fine (one level up)
A.does_not_exist;  // never returns; the process must be killed externally
```

Reproduced on current main (and structurally present in every release, since
the loops predate them). Writes are unaffected (`ucv_key_set` targets the
receiver only), which makes the failure mode nastier in practice: a service
can create and use a cyclic object indefinitely and only lock up on the first
typo'd or optional member read — a hang, not a crash, so procd never restarts
it.

Possible fixes, in order of preference:

1. Reject cycle creation in `ucv_prototype_set()` — walk the proposed
   prototype's chain and return `false` if it contains the target (chains are
   short; the check is O(depth) at set time only).
2. Guard the lookup walks with Floyd/visited-set or a depth cap.

Related but distinct prior work: #410 fixed a refcount leak in
`ucv_prototype_set()` (965d765); #363 discussed resource values as prototype
targets. Neither touches lookup termination — the walk loops have had no
guard since the internal data-type rework (35af4ba).

Happy to submit a PR for option 1 if that direction is acceptable.

*(Searched before filing: issues+PRs for proto/prototype/hang/infinite
loop/endless/freeze/deadlock/cycle/recursion and the three function names —
no existing report.)*

---

(File manually or with: `gh issue create -R jow-/ucode --title … --body-file …`)
