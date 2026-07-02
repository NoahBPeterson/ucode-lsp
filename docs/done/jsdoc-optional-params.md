# JSDoc optional parameters (`@param {T} [name]`) — BUILT 0.7.39

## Problem

Annotating a user function's params with `@param {object} sink` made `sink`
**required**: any call omitting it got "expects argument 'sink'" (error under
`'use strict'`), even when the function is deliberately tolerant of omission.
The author had no working vocabulary for "typed but truly optional":

- `@param {object} [sink]` — the standard JSDoc optional syntax — failed the
  `@param` regex (`(\w+)` name) and was **silently dropped**: no arity warning,
  but the type vanished too (hover `unknown`, no arg checking).
- `{object=}` / `{?object}` (Closure optional/nullable) resolved to `null` →
  false UC7001 "Unknown type".
- Only `{object|null}` and `{object?}` worked.

Surfaced by the gl-ucode rpc test harness: `call(body, reqinfo, sink)` where
`body` is required, `reqinfo` defaults via `??`, `sink` is truly optional.

## Design

The arity rule itself was already right: *a missing argument passes `null`, so
omission is flagged iff `null` contradicts the declared param type*. ucode has
no `undefined`, so **optional ≡ nullable** — `[sink]` is sugar for
`object|null`. One representation drives everything: the arity check (skips
null-admitting params), body-side typing (`sink` is `object | null` inside the
function), and hover (shows the truth).

## Changes

- **jsdocParser.ts** — `@param` brace regex accepts `[name]` / `[name=default]`
  (brackets/default stripped from `name`; tag marked `optional`).
  `resolveTypeExpression` handles `{T=}` and `{?T}` → `T|null`; the existing
  `{T?}` path now widens complex types (e.g. `array<string>?`) too.
- **symbolTable.ts** — `widenWithNull(type)` helper (`T` → `T|null`; unions get
  a null member; module types returned unchanged). `ParamInfo.optional` +
  `Symbol.jsdocOptionalParam` carry the flag for types that can't hold a null
  union member.
- **semanticAnalyzer.ts** — `applyJsDocToParams` widens an optional param's
  declared type and stamps the symbol; both ParamInfo builders (named fn +
  fn-expression/arrow) thread `optional` into the signature.
- **typeChecker.ts** (`checkUserFunctionCall`) —
  - honors `ParamInfo.optional` in addition to the null-union test;
  - a union **without** a null member (`{object|string}`) is now correctly
    required (it previously collapsed to UNKNOWN and was never flagged);
  - missing-arg diagnostic anchors on the **callee**, not the whole call;
    too-many anchors on the extra arguments themselves;
  - the message teaches the syntax: "…If that is intended, declare it
    optional: `@param {object} [sink]`".

## Tests

`tests/diagnostics/test-user-function-args.mocha.js` — new "JSDoc optional
parameters" suite (10 tests): each optional spelling, type retention of
bracketed params (hover `T|null`), no false @param-mismatch, the rpc-test
mixed-signature scenario, strict escalation, message hint, both anchor ranges.
Demo: `zzzz/jsdoc-optional-params.uc`.
