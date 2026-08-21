# Model `proto()` once, as its own concept — not per-check special cases

Status: **BUILT 0.8.11 (uncommitted, awaiting user test).** Filed 2026-08-14 on
user direction: "handle proto objects like the special objects that they are,
rather than special arrays or special objects or special everythings."

## As built (2026-08-15)

One model, `src/analysis/protoResolver.ts` (pure AST helpers: `asProtoCall`,
`collectPrototypeInstances`, `collectPrototypeMethodFunctions`,
`declaratorInitNear`, `instanceBaseType`), consumed by the semantic analyzer,
which stamps the MERGED chain shape onto the ordinary symbol maps
(`propertyTypes` / `propertyReturnTypes` / `propertyDefinitionLocations` /
`nestedPropertyTypes`) — so completion, hover, go-to-definition, signature
help, member typing, `this` typing, and json() readability all resolve through
the channels they already read. Stamping paths: declarator `let w = proto(V,P)`
(Case 1c), assignment `w = proto(V,P)`, bare re-parent `proto(w, P);` (REPLACE
semantics: previous chain's contributions removed first, own members cloned
before mutation — several stamp paths share map references), and factory
returns `return proto({…}, P)` (flows through the existing
returnPropertyTypes/copyFactoryReturnToBinding pipeline).

`this` inside prototype methods is the INSTANCE: base type from `proto(V,P)`
sites (array instances keep type `array` — `shift(this)` legal; commits only
when EVERY instance's type is proven), fields as the union of instance own
fields over the table's (known types beat UNKNOWN — the table is visited before
instance sites, so constructor-param-fed fields would otherwise swallow proven
types). Covers all three real idioms: inline methods, `let wdev = {…}; return
proto(wdev, wdev_proto)` (identifier instances resolve scope-aware via
`declaratorInitNear`), and the wifi-scripts free-function table (`function
setup() { this.state… }` + `const wdev_proto = { setup, … }` — declarations
referenced by name from an instanced table get instance-shaped `this`).
`ThisExpression` in the type checker now reads the declared `this` symbol
instead of hardcoding OBJECT. `findFunctionNodeAt` (server.ts) also matches a
property KEY anchor so signature help resolves key-anchored member locations.

Verified: 87 new tests (47 unit `tests/unit/test-proto-resolver.test.js`, 40
e2e `tests/test-proto-first-class.test.js` — cyclic re-parenting, mixed
object+array instances, own-shadows-proto, 1-arg proto, extra-arg proto
(oracle-checked), spread args/properties, computed keys, aliasing, ambiguous
tables, scope decoys (incl. arrow scopes), known-beats-unknown, alias chains,
UC8016 incl. REPLACE-edge identity, sig help + go-to-def through shorthand
tables), demo
`zzzz/proto-first-class-demo.uc` (0 diagnostics, hovers server-verified, runs
in owrt-main). Corpus sweep 284 files: **−8 / +0** — LuCI runtime.uc ×6
(`this.scopes` now array: push/pop warnings gone, both copies) and unetmsg
client.uc ×2 (former sev1 ERRORS: `keys(this.cb_pub)` / `keys(this.cb_sub)`).

Still open from the proposal: typo detection (item 5 — severity undecided, a
user call); method return types through same-file factory BINDINGS
(`let w2 = wdev_new(); w2.get_name()` hovers `unknown` — parity with existing
plain-object factory behavior, not a regression).

## proto() is NOT rare — it is ucode's class mechanism

32 call sites across the tracked trees, plus an established naming idiom for
the "class" object:

| file | prototype |
|---|---|
| `wifi-scripts/.../hostap/common.uc:182,352` | `phy_proto`, `vlist_proto` |
| `wifi-scripts/.../lib/netifd/wireless-device.uc:625` | `wdev_proto` |
| `unetmsg/.../unetmsgd-client.uc:12` | `pubsub_proto` |
| `unetmsg/.../unetmsgd.uc:224` | `core_proto` |
| `provision/.../provision.uc` | `provision_proto` |
| `luci-base/runtime.uc:153` | `proto({…}, Class)` |

Instances are made with `proto({ own: fields }, X_proto)` and used as objects
with methods. ucode has no `class`; this IS the OO story.

## What we do today

- **Objects + proto: no errors, but no help either.** Member checks on plain
  objects are permissive, so nothing false-positives — and nothing resolves.
  Measured on the `wdev_proto` shape:
  - completion after `w.` → **nothing** (should offer `get_name`, `set_config`)
  - hover on `w.get_name` → **`unknown`**
  - go-to-definition → nothing
  - a typo (`w.nonexistant`) → silent
- **Arrays + proto: was a hard error**, "Arrays in ucode have no properties or
  methods" — fixed 2026-08-14 by having the array-member check consult the
  chain (`effectiveMembers` + `mayHavePrototype`).
- **json(): handled** by `jsonSourceReadability` (readable/not-readable/unknown).

That is exactly the "special everythings" the ticket title warns about: three
checks each grew their own prototype awareness.

## The runtime rules — VERIFIED LIVE on owrt-main (2026-08-14)

Run against the real interpreter, not just read out of the C source:

| probe | result |
|---|---|
| `proto([…], {read})` → `json()` | parses (1-level **and** 2-level chain) |
| `proto([], { read: 5 })` → `json()` | throws `Input object does not implement read() method` |
| `proto(5, {…})` | throws `Passed value is neither a prototype, resource or object` |
| second `proto(v, P2)` | REPLACES — a previously-parseable value now throws |
| `proto([3,1,2], {mylen, first})` | `type()` is still `array`; `a.mylen()`=3, `a.first()`=3, `a[1]`=1, `length(a)`=3 — methods, `this`, and numeric indexing all at once |
| `plainArray.foo` (no prototype) | **null, no crash** |
| `"abc".foo` | **throws** `left-hand side expression is not an array or object` |

That last pair matters for severity: a missing member on an ARRAY is a silent
null (a bug, but not a crash — exactly the `st.ino` shape), while on a STRING it
is a hard runtime error.

## The runtime rules (types.c / lib.c)

- `ucv_prototype_get` has a proto slot for **UC_ARRAY, UC_OBJECT and
  UC_RESOURCE** (the resource TYPE's prototype is how `fs.file.read()` works).
- `ucv_key_get` walks the chain and **skips non-object levels**
  (`if (ucv_type(o) != UC_OBJECT) continue`), so an array's own level is passed
  over and its prototype's members resolve; numeric indexing is a separate,
  earlier path — both work at once.
- `ucv_prototype_set` accepts only ARRAY and OBJECT targets, and the prototype
  must itself be an OBJECT. **Scalars can never carry one**, so "strings have no
  members" stays sound.
- A later `proto(v, P)` REPLACES the prototype; it does not merge.
- One-argument `proto(v)` READS the prototype instead of setting it.

## Proposal

Promote the existing `effectiveMembers()` (typeChecker) into the single
member-resolution entry point, and give the type model a way to carry "this
value's members include its prototype chain". Then every consumer gets it for
free instead of bolting on its own check:

1. **Member resolution** (UC5003/UC5004/UC5007) — already partly done.
2. **Completion** — `w.` offers the prototype's members.
3. **Hover / signature help / go-to-definition** — resolve to the prototype's
   function node.
4. **`this` typing** — subsumes `docs/this-in-prototype-methods.md`: inside a
   method reached via `proto(v, P)`, `this` is **v**, not P. That ticket's
   "targeted fix" option becomes a natural consequence rather than a special
   case, and it kills the remaining `shift(this)` false positive.
5. **Typo detection** — a member absent from own fields AND the whole chain is
   reportable (severity to be decided; the chain must be fully enumerable).

Existing building blocks: `effectiveMembers(node, depth)` (own members +
chain, depth-capped, reports `complete`), `mayHavePrototype(node)`,
`inPlaceProtoArgs(name)` — all in `src/analysis/typeChecker.ts`.

## Decided against

Fixing json()'s accepted-argument set to a literal `string | object`: arrays
are legal input when proto'd (ucode's own json() docs use exactly that), so no
fixed allow-set is correct. The three-way readability verdict is the accurate
model.
