# UC2009 FP: member read BEFORE any write uses the earliest/flat write type

Status: **NOT STARTED - 🟡 MEDIUM PRIORITY** (5 hard-error FPs on glinet firewall.uc:523-527).
The MEMBER-property twin of the fixed identifier bug
(docs/uc2009-branch-reassign-declared-null.md, shipped 0.7.81) - split out when that fix
left these standing.

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
