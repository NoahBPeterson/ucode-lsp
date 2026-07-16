# Member call on an inline `require('mod')` result loses the module type

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** `checkCallExpression`
now resolves a member call whose receiver is *any* expression (not just an Identifier) carrying
a known module type through `MODULE_REGISTRIES`, same as the bound-variable path.

## Fix

`src/analysis/typeChecker.ts`, `checkCallExpression`'s "Handle member expression calls" section
(~line 2645, right after the existing identifier-receiver "Namespace module calls" branch and the
"Unimported known module" check): new branch —

```ts
if (memberCallee.object.type !== 'Identifier' && memberCallee.property.type === 'Identifier') {
  const recvType = this.checkNodeQuietly(memberCallee.object);
  const modInfo = extractModuleType(recvType);
  if (modInfo && isKnownModule(modInfo.moduleName)) {
    const methodName = (memberCallee.property as IdentifierNode).name;
    const registry = MODULE_REGISTRIES[modInfo.moduleName as keyof typeof MODULE_REGISTRIES];
    const funcOpt = registry.getFunction(methodName);
    if (Option.isSome(funcOpt)) {
      let returnTypeData = this.parseReturnType(funcOpt.value.returnType);
      returnTypeData = this.narrowFsReturnType(returnTypeData, funcOpt.value, node);
      return returnTypeData;
    }
  }
}
```

This reuses the existing require() special case (`validateBuiltinCall`, ~line 2736-2742, which
already types `require('mod')` as `{ type: OBJECT, moduleName: 'mod' }` via `extractModuleType`)
rather than re-parsing the literal argument — so it isn't `require`-specific: any receiver
expression that resolves to a module type is handled (not just a literal inline `require()`
call), mirroring the ticket's "resolve the member through the module registry exactly as the
variable path does" instruction. `checkMemberExpression`'s chained-receiver branch (the other
site named in the root cause) was left untouched — the fix lives entirely in the call-resolution
path, which is what the demonstrated bug (member *calls*) needs; a bare property read of a
function-valued module member (`let fn = require('ubus').connect;`, no call) is a separate,
narrower gap not covered by this ticket's repro.

Verified via hover: `require('ubus').connect()` → `ubus.connection | null`;
`require('fs').open("x")` → `fs.file | null` (narrowed); the mwan4 lazy-connect idiom
(`if (!ubus_conn) ubus_conn = require('ubus').connect();`) now types `ubus_conn` as
`ubus.connection | null` at both the assignment and later reads. Real corpus site:
`mwan4/files/lib/mwan4/mwan4.uc:262`. Isolated (pristine-HEAD + only this patch) delta on that
file: 71.6%→71.7% (1829/2553→1831/2553, 724→722 unknown) — small because the downstream
`ubus_call()` return-type propagation to its callers (mwan4.uc:267 etc., `m.ubus_call` in cli.uc,
hotplug_iface.uc) needs `tc-callsite-param-inference-crossfile.md` too, as originally noted.

Tests: extended `tests/diagnostics/test-require-builtin-typing.test.js` with 5 new cases (13-17:
`require('ubus').connect()`, `require('fs').open("x")` narrowing, the mwan4 idiom, a
non-module call-result receiver unaffected, and an unknown member on a module receiver staying
error-free) — all 17 tests in that file green. Full suite: 3129 pass / 0 fail across 261 files.

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
