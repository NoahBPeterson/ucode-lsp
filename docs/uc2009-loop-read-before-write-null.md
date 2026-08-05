# UC2009 FP: in-loop read BEFORE the loop's writes types as declared-null

Status: **COMPLETE at 0.7.92 — third wave (2026-08-04) adds within-iteration
DOMINANCE (an in-loop write REPLACES for reads it provably precedes on every
path: read in the write's innermost loop + write textually first + same branch
frame + no closure boundary between, via the growing fnBodyExtents registry —
symbolTable writeDominatesIteration) and the stale-diagnostic SECOND LOOK
(UC2004/incompatible-function-argument hard errors on null-seeded operands
carry data.staleTypeArg; the post-filter re-resolves and downgrades to the
may-be nullable-argument form when a compatible member joined — gated to
emit-types containing null so guard-narrowed claims are never softened).
`memberWriteType` makes member compound assigns (`||=`/`??=`/`+=`) record the
operator-aware union like identifiers, which dominance made load-bearing.
131 loop-machinery tests across 5 suites; corpus delta = 1 honest `??=[]`
seed warning (parental-control.uc:591) + 1 honest fw4 keys warning.
IMPLEMENTED at 0.7.92 (2026-08-04, uncommitted — awaiting user test),
PLUS the soundness ruling follow-up (same version): in-loop MEMBER writes are
union-only (I-3 closed — rv.days honest union + warning), derived bindings
re-stamped post-analysis (restampDerivedBindings, widen-only/concrete-only),
keys(maybe-object) refines to `array<string> | null`. Contract updates:
tests/inference/test-flow-sensitive-member-types.test.js (4),
tests/syntax/test-builtin-return-narrowing.js (1). Fallout: glinet corpus
byte-identical; fw4.uc gains exactly ONE honest warning (keys(rv.days)
zero-iteration path). +9 soundness-contract tests
(tests/diagnostics/test-loop-soundness-contracts.test.js).**
Mechanism: (1) `TypeHistoryEntry.loop`/`PropertyWriteEntry.loop` = OUTERMOST
enclosing loop extent (whole statement, so test/update reads count); both walks
union writes whose extent contains the read even when `from > readPos`
(union-only, never definite/elseType — iteration 1 keeps the prior value);
`bodyWriteCannotHaveRun` also accepts a call site inside the shared loop.
(2) Because diagnostics are emitted MID-PASS from partial history (the real
root of the hover/lint divergence), UC2009 'impossible' now records its
identifier/member operands + at-emit base members (`impossibleCompareRefs`)
and the post-analysis filter re-resolves them against the complete history —
dropping the claim only when a NEW SCALAR-ish member appeared (reference/null
growth keeps it: references still never equal a scalar). Tests:
tests/diagnostics/test-loop-read-before-write{,-corners}.test.js (8 + 48).
Real LuCI commands.uc parse_args verified clean of the FP.

## The report (LuCI, verbatim shape)

```ucode
function unquote(start, end) {
    let esc, quote, res = [];
    for (let off = start; off < end; off++) {
        const byte = ord(str, off);
        const q = isquote(byte);
        ...
        else if (e && quote != 39) {   // UC2009: "a value of type `null` can never
            esc = true;                //  be != 39 ... always true" — FALSE POSITIVE
        }
        else if (q && quote && q == quote) {
            quote = null;
        }
        else if (q && !quote) {
            quote = q;                 // quote becomes integer on later iterations
        }
        ...
```

Hover on `quote` says `integer | null` (correct!). The UC2009 comparison lint
saw a definite `null`. Reduced repro confirmed at 0.7.90 (scratchpad
luci-repro.uc): the FP needs only a bare `let quote`, a loop, a read of `quote`
textually BEFORE any write, and writes later in the same loop body.

## Root cause

`effectiveSymbolType`'s branch-aware walk only unions typeHistory entries whose
write position precedes the read (`from <= readPos`); entries from writes later
in the SAME loop body are "future" and skipped, so the walk falls back to the
declared type — `null` for a bare `let`. But a loop back-edge delivers those
later writes to earlier iterations' reads: on iteration 2+, `quote` at the
`!= 39` read really can be the integer written on iteration 1. The campaign's
"in-loop writes ALWAYS union" contract (0.7.85) covers reads AFTER the write
position; read-BEFORE-write-in-the-same-loop is the documented loop-contract
gap (audit I-3 / the rv.days FN cost) — this ticket is its first user-hitting
FALSE-POSITIVE instance, which changes the cost-benefit of that open decision.

The hover/UC2009 divergence is because hover's query path applies the
loop-carried join (0.7.69) while the comparison lint reads the positional walk
— whichever way the loop contract lands, the two consumers must agree.

## Fix sketch

For a read INSIDE a loop, the walk should also union typeHistory entries
written ANYWHERE in the same loop body, even when `from > readPos` (they reach
the read via the back edge). Mechanically: TypeHistoryEntry already carries
`inLoop`; it needs the loop EXTENT (start/end offsets, or a loop id) so the
walk can test "read and write share a loop". Same extension for
`propertyTypeAt` (member twin). Definite-write promotion must NOT apply
(a back-edge-delivered write is never definite for an earlier read — union
only, with the declared/pre-loop type).

Contract note: this is one half of the open loop-contract decision. The other
half (post-loop reads of loop-body writes, rv.days) can stay as-is or be
decided together — user call, but the FP half alone is defensible: it only
ADDS union members at in-loop reads, it never deletes anything.

## Tests

The LuCI shape above (UC2009 must NOT fire; hover `integer | null`); the same
with the read/write order flipped (already-covered contract, must stay);
while-loops and for-in; a NON-loop read-before-write control (`let q; use(q);
q = 1;` — declared-null typing must stay, that read really is null); nested
loops (inner read, outer write and vice versa); member twin
(`obj.p` read-before-write in a loop).
