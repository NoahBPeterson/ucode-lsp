# UC2009 FP: member read BEFORE any write uses the earliest/flat write type

Status: **IMPLEMENTED 0.7.84 (uncommitted, awaiting user test).** Four-part fix
(part 4 added after user review caught the post-ladder read claiming a definite
`array<string>` - a null/integer input matches no branch and flows through, so
conditional writes now UNION into the prior value instead of replacing it; the
`if (type(x.p) != "T") x.p = ...` normalization idiom stays precise via a
fall-through elseType stamp, keeping glinet ui.uc:66 clean):
(1) `recordPropertyWrite` captures the write's START and, on first write, preserves any
pre-existing flat type (object-literal/JSDoc/import shape) as a pos=-1 BASELINE entry;
(2) `propertyTypeAt` resolves pre-write reads as inside-first-write -> that write's type
(the rv.days bucket-target hover), else baseline (declared type), else UNKNOWN - never a
future write's type; (3) writes snapshot the analyzer's new `branchStack` so a read in a
SIBLING else/else-if of the same if-statement treats the write as invisible (the else-if
ladder's reads 2..n positionally FOLLOW write 1 but flow-wise exclude it). Loop bodies
deliberately NOT treated as branches - post-loop reads keep the definite written type
(shipped rv.days contract, tests/inference/test-flow-sensitive-member-types.test.js).
Corpus differential: firewall.uc 5 UC2009 -> 0, PLUS two more instances of the same class
(wifi.uc:523 UC2015 "string vs 0" from the future `= "auto"` write; ovpn_client.uc:37
nullable-argument from a future write), zero other changes. Tests:
tests/diagnostics/test-member-prewrite-read.test.js (6). Was: **NOT STARTED - 🟡 MEDIUM
PRIORITY** (5 hard-error FPs on glinet firewall.uc:523-527). The MEMBER-property twin of
the fixed identifier bug (docs/uc2009-branch-reassign-declared-null.md, shipped 0.7.81).

## The FP

```ucode
// firewall.uc:523-527 - param comes from the app; param.proto is a STRING here
if (param.proto == "tcp udp") param.proto = ["tcp", "udp"];   // UC2009: `array` can never be == "tcp udp"
else if (param.proto == "tcp") param.proto = ["tcp"];         // UC2009 ...
else if (param.proto == "") param.proto = ["all"];
```

Every test claims `param.proto` is `array` - the type of the assignments that haven't
happened yet. The whole point of the ladder is to normalize a string INTO an array.

## Root cause (located, not yet fixed)

`propertyTypeAt` (symbolTable.ts ~343) is positional, but when the read PRECEDES every
recorded write it falls back to `earliest.type` - a fallback added for hovering the write
TARGET itself (`(rv.days ||= {})` should hover `object`) - and failing history, to the flat
`propertyTypes` map (most-recent-overall). Both give a FUTURE write's type to a genuinely
earlier read. For an unannotated receiver (`param` is a parameter - unknown), the correct
pre-write answer is "no information" (unknown), which silences the lint.

## Fix sketch

Record the assignment's START alongside `pos` (end) in `propertyTypeHistory` entries; in
the read-precedes-all-writes case return `earliest.type` ONLY when `readPos >= earliest.start`
(the hover-the-write-target case) and otherwise `undefined`/receiver-declared shape - and
audit the flat-`propertyTypes` fallback the same way. Mirror the 0.7.81 identifier fix's
loop caution: joining rather than picking may be needed to keep loop-carried may-null
signals intact (see the union approach and the test-08 contract note in
tests/test-tc-loop-carried-flow.test.js).

## Tests

The firewall ladder (0 UC2009); hover on `(rv.days ||= {})` still `object` (the fallback's
original purpose, tests exist from that era); post-ladder reads still type as array;
object-literal-declared properties keep their pre-reassignment type for pre-write reads.
