# utest mock proxies: `mock.global.patch('fs', …)` should type as the mocked module

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit. Layered on top of
`docs/tc-module-search-roots-deploy-layout.md` + `docs/tc-barrel-reexport-typing.md` (which make
`mock` itself resolve); this ticket covers what remains once those land.

## The gap

utest's mock API returns runtime-built proxy objects that *behave as* a named module. Their whole
point is API-compatibility with the module they mock — but they type as `unknown`, so none of the
module's method typing applies in tests:

```ucode
// utest/examples/unit/09_mock_state_test.uc:16-17
const m_fs = mock.global.patch('fs', { data: { '/tmp/b.txt': 'patched' } });
assert.match('patched', m_fs.readfile('/tmp/b.txt'));      // m_fs: unknown ×97 cluster

// 13_uci_test.uc:32-35
let c = m_uci.cursor();                                     // should be uci.cursor | null
assert.match('1', c.get('luci-sso', 'default', 'enabled')); // c: unknown ×36

// 12_ubus_test.uc:11-12 — m_ubus.connect() → ubus.connection
// 15_uclient_test.uc:9-11 — m_uclient.new(…) → uclient handle
// 11_mocking_fs_test.uc:220-223 — m_fs.open(…) → fs.file
// 08_….uc — mock.inject('fs', {…}, (m_fs) => { … })  — callback param, same shape
```

Audit occurrences: `mock.global.patch` 80+17, `m_uci.cursor` 25+11, `m_ubus.connect` 19+9,
`m_uclient.new` 15+11, `m_fs.open` 18+6, `mock.snapshot`/`inject` reads ≈ **~210** in the utest
examples alone.

These are NOT user modules shadowing builtin names (the audit brief's hypothesis): the module name is
a **string argument** (`patch('uci', …)`), and the proxy is assembled dynamically
(`utest/src/utest/mock/global.uc:89` `export function patch(name, state)` → `build_proxy` →
`engine`-registered channels). No amount of general inference can recover a shape from that — the
mapping "returns a proxy of module `<name>`" is framework knowledge.

## Root cause

- `patch(name, state)`'s return value is a dynamically-built object — general analysis correctly
  gives `object`/`unknown`; the module identity lives in the string argument's VALUE.
- The LSP has no "returns the module named by argument N" signature concept. The nearest precedent
  is `require(<literal>)` (typeChecker.ts:2677-2683), which does exactly this for one specific
  callee, and the per-param `constantPrefixes` metadata (0.7.52) which already attaches
  argument-value semantics to specific module functions.

## Proposed approach

A small framework-typing rule, activated only when the callee resolves to the utest mock module
(post barrel/root fixes — do NOT trigger on arbitrary functions named `patch`):

1. Add an optional signature field (e.g. `returnsModuleOfArg: 0`) usable by module registries and by
   the cross-file signature path. When the call's argument 0 is a string literal naming a known
   builtin module (`isKnownModule`), the call types as `{ type: OBJECT, moduleName: <arg> }` — the
   same ModuleType `require('fs')` produces, so `m_fs.readfile` / `m_fs.open().read()` resolve
   through the existing MODULE_REGISTRIES machinery.
2. Apply it to `mock.global.patch`, `mock.global.unpatch` (returns void — n/a), `mock.inject(name,
   state, cb)` — typing the **callback's first parameter** the same way (contextual param typing,
   mirroring the filter()-callback machinery), and `spy.on`-style wrappers if present.
3. Since utest is a user module (not a compiled-in registry), the flag needs a carrier: either a
   tiny built-in ambient description of the utest framework (like the uhttpd/netifd ambients — keyed
   on resolving imports to a module whose canonical path ends `utest/mock/global.uc`), or a JSDoc
   extension (`@returns {module(name)}`) the analyzer understands in utest's own source (it is
   JSDoc'd already).

Fallback either way: non-literal or unknown module names stay `object` (the honest answer).

## Classification

**Partially solvable** — literal-module-name calls: fully (the entire example corpus uses literals);
dynamic names: by design not typeable. **~210 occurrences**, contingent on
tc-module-search-roots-deploy-layout.md + tc-barrel-reexport-typing.md landing first.
