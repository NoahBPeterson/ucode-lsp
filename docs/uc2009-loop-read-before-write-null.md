# UC2009 FP: in-loop read BEFORE the loop's writes types as declared-null

Status: **NOT STARTED — 🟠 HIGH PRIORITY** (hard-error FP on real upstream LuCI
code — jow's shell-quoting `parse_args`, reported 2026-08-03).

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
