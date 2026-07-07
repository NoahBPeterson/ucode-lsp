# Member call on an inline `require('mod')` result loses the module type

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

`require('ubus')` IS generically typed as the ubus module (0.6.185) — but only when it lands in a
variable first. Chaining a member call directly on the call result drops the type:

```ucode
let x = require('ubus');
let y = x.connect();                    // ✓ ubus.connection | null
let z = require('ubus').connect();      // ✗ unknown   (verified repro)
```

The corpus hits this through the standard lazy-connection idiom:

```ucode
// mwan4/files/lib/mwan4/mwan4.uc:260-264
function ubus_call(path, method, args) {
	if (!ubus_conn)
		ubus_conn = require('ubus').connect();     // ubus_conn: unknown  ← the chain bug
	return ubus_conn?.call(path, method, args || {});  // → ubus_call(): unknown
}
// mwan4.uc:267,272,278,284,294,431,1579 — every `let s = ubus_call(…)` is unknown,
// plus mwan4/files/lib/mwan4/cli.uc:190 (`m.ubus_call`) and hotplug_iface.uc:52.
```

Audit occurrences rooted here: `ubus_call` clusters (7 + 8 + 8 + 10) + `m.ubus_call` (3 + 6) +
`ubus_conn` reads ≈ **45**, all of which become `object | null` once the chain resolves (pbr's
`config.ubus_call` — 15 more — is the same shape but routed through a factory param, so it needs
tc-callsite-param-inference-crossfile.md too).

## Root cause

Two resolution paths exist for member calls, and the call-result-receiver one lacks a module branch:

1. `checkCallExpression` "namespace module calls" (`src/analysis/typeChecker.ts:2554-2570`) requires
   `memberCallee.object.type === 'Identifier'` — an inline `require('ubus')` receiver is a
   `CallExpression`, so it never matches.
2. It then falls to `checkNode(node.callee)` → `checkMemberExpression`, whose chained-receiver branch
   (`typeChecker.ts:3274-3291`) computes the receiver type quietly and resolves the member **only
   against `OBJECT_REGISTRIES` via `detectObjectType`** (objectKind handles like `fs.file`,
   `uci.cursor` — this is why `uci.cursor().get(…)` chains DO work). The receiver type here is a
   **ModuleType** (`{ type: OBJECT, moduleName: 'ubus' }`, produced by the require special case at
   :2677-2683), and there is no `extractModuleType → MODULE_REGISTRIES` branch — so it falls through
   to `unknown`.

## Proposed approach

In `checkMemberExpression`'s chained-receiver branch (and/or in `checkCallExpression` before falling
back): after `checkNodeQuietly(node.object)`, if the receiver type carries a `moduleName` that
`isKnownModule`, resolve the property via `MODULE_REGISTRIES[mod].getFunction(propName)` exactly like
the identifier-receiver namespace branch, including `narrowFsReturnType` argument narrowing for the
call case. This mirrors the existing objectKind handling one line above it; no new machinery.

Test cases: `require('ubus').connect()` → `ubus.connection | null`; `require('fs').open("x")` →
`fs.file | null` (with narrowing); non-module call-result receivers unaffected; unknown member on a
module receiver keeps the existing conservative no-error behavior of the chained path.

## Classification

**Solvable** (small, mechanical — one missing branch, mirrors adjacent code). **~45 occurrences**
directly (mwan4 dominates), unlocking `object | null` on every downstream ubus reply read.
