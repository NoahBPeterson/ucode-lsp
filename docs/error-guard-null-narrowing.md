# Error-guard null narrowing (the `require_param` idiom)

Status: **OPEN — user-requested 2026-08-08.** This is the concrete, corpus-grounded
form of the long-open "correlated-flag narrowing" item
(docs/TRIAGE-2026-07-07-type-coverage.md STILL-OPEN list).

## Repro (luci-app-podman volume CLI helper, verbatim shape)

```ucode
import { validate_int, validate_name, require_param } from 'luci.podman_validate';

function die(msg) { warn(`${msg}\n`); exit(1); }   // neverReturns (already inferred)

let volumeName = ARGV[1];          // string | null (container-read | null)
let compressed = ARGV[2];
let volumeData = ARGV[3];

let err = require_param('volumeName', volumeName) || validate_name(volumeName)
       || require_param('volumeData', volumeData)
       || require_param('compressed', compressed) || validate_int(compressed);
if (err) die(err);

let decoded = b64dec(volumeData);  // volumeData STILL string | null — should be string
```

Where `require_param` (cross-file, luci.podman_validate) is:

```ucode
export function require_param(name, value) {
    if (value == null || value === ''
        || (type(value) === 'object' && length(keys(value)) === 0))
        return `Missing required parameter: ${name}`;
};
```

The user's expectation: after `if (err) die(err);`, null is narrowed out of
`volumeName` / `volumeData` / `compressed`.

## Why it is sound

1. `require_param`'s body returns a NON-EMPTY STRING LITERAL (truthy) on the branch
   whose test includes `value == null`, and falls off the end (implicit null) on
   every other path. Therefore: **result falsy ⇒ `value != null`** (also ⇒ not '',
   but the null arm is the narrowing payload).
2. `err` is the `||` of five calls. `||` yields the first truthy arm, so
   **err falsy ⇒ every arm falsy** — including each `require_param(..., v)` arm.
3. `die` never returns (already inferred via the exit() terminator fixpoint), so
   the code after `if (err) die(err);` is exactly the err-falsy path.
4. Chaining 1+2+3: after the guard, each `v` passed to a `require_param` arm is
   non-null — PROVIDED neither `err` nor any of those `v`s was reassigned between
   the assignment and the guard (write-invalidation is mandatory for soundness).

## Design

**Phase 1 — contract inference** (`nullGuardParams: Set<paramIndex>` on the
function symbol):
- Pattern: every `return <expr>` with a provably-truthy expr (non-empty string
  literal / template literal with literal head, true, non-zero number) is
  dominated by a test containing a top-level `||`-arm of the form
  `param == null` / `param === null` / `!param`; all other paths return
  null/undefined/implicitly. Then falsy-result ⇒ that param non-null.
- Same-file: compute in the analyzer next to return-type inference.
- Cross-file: fileResolver already parses exported function ASTs (return types,
  ParamInfo) — add the same body scan there and carry the set on the imported
  symbol (mirrors the 0.8.2 bracket-optional fix's shape).

**Phase 2 — implication capture**: at `let err = <expr>` where expr is an `||`
chain (or single call): for each arm `f(...)` whose callee has nullGuardParams,
and whose flagged argument is a plain identifier, record on `err`'s symbol
`falsyImplications: Array<{ symbol, position }>`.

**Phase 3 — application**: wherever flow already knows `err` is falsy —
`if (err) <all-paths-terminate>` fall-through, and the plain `else` branch —
strip null from each implied symbol via the same mechanism the existing
`if (!x) return;` guard narrowing uses (flowTypeEngine). Invalidation: any write
to `err` or to an implied symbol between capture and application drops that
implication (loop back-edge stamps from 0.7.92 apply — a capture inside a loop
must not narrow a read reached via the back edge).

## Cautions

- Do NOT infer from `validate_name`/`validate_int` (they reject on CONTENT, not
  nullness — validate_int(null)'s behavior differs); only the null-arm pattern
  licenses non-null. The `||` chain still works: the require_param arms alone
  carry the narrowing.
- This must live in flowTypeEngine (the sound engine), not the retired CFG typing
  path ([[cfg-and-flow-engine]] rules).
- Regression sentinels to add: the verbatim repro above; a reassigned-err
  counterexample; a loop-carried counterexample; cross-file + same-file variants.
