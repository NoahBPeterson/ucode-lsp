# `proto(<resource>, P)` throws, and we do not flag it

Status: **FIXED 2026-08-21 (same round), once the container came back.**
Both positions are now checked, by VERIFIED resource type.

## As built

`RESOURCE_BACKED_OBJECT_TYPES` (moduleDispatch.ts) — the 39 registry entries
that are C resources, taken from every `uc_type_declare()` in `ucode/lib/*.c`
and the OpenWrt packages, spot-checked live on owrt-main: fs.file, fs.dir,
fs.proc, uloop.timer and uci.cursor all report `type()=="resource"` and throw
on attach, while fs.stat, fs.statvfs and the exception object report
`"object"` and attach fine. Notably hostapd.* and wpas.* ARE resources
(uc_type_declare in the hostapd package) — assuming otherwise would have been
a false negative.

`validateProtoFunction` reports a provable handle in EITHER position, and
does so INSTEAD of the generic contract diagnostic (no "may be null" pile-on
on a call that throws regardless):

- target:    "proto() cannot attach a prototype to a fs.file handle - this
              throws at runtime. Only arrays and objects can carry one."
- prototype: "proto() cannot use a fs.file handle as a prototype - this
              throws at runtime. A prototype must be a plain object."

A `handle | null` counts as provable (both branches throw); a genuine
`object | handle` union does not. The 1-arg read form stays silent for every
type. 12 tests in tests/unit/test-proto-argument-contract.test.js; corpus
sweep unchanged at -8/+0. Demo: zzzz/proto-contract-demo.uc §4.

## The gap

`ucv_prototype_set()` (types.c) accepts only `UC_ARRAY` and `UC_OBJECT`, so a
resource handle can never be GIVEN a prototype — `uc_proto` raises
"Passed value is neither a prototype, resource or object". Confirmed live:

```ucode
import { open } from 'fs';
let fh = open("/etc/hostname", "r");
proto(fh, { m: 1 });        // THROWS at runtime
```

We currently report this only by accident, when the handle is nullable
(`open()` returns `fs.file | null` → the ordinary "may be null" check). Guard
the null away and we say nothing:

```ucode
if (fh) {
	proto(fh, { m: 1 });    // CLEAN today — provable throw, no diagnostic
}
```

Reading is fine and must stay clean: `ucv_prototype_get` handles `UC_RESOURCE`
by returning the resource TYPE's shared prototype (this is how `fs.file`
methods resolve), and the 1-arg form never throws.

## Why it is not fixed yet

The check would flag argument 1 when its type is a known handle/resource
object type. The risk is precision: `OBJECT_REGISTRIES` covers both true C
resources (fs.file, fs.dir, fs.proc, socket, ubus, uloop, nl80211, rtnl,
struct.buffer, zlib, digest …) and shapes that are plain ucode dictionaries,
for which `proto()` is perfectly legal. Flagging a dictionary-backed entry
would be a false positive on working code.

Resolution requires enumerating each registry entry against the interpreter
(`type(x) == "resource"`), which needs the OpenWrt containers — unavailable
when this was found.

## Plan

1. In the container, for every entry in `OBJECT_REGISTRIES`, evaluate a real
   instance and record `type()`.
2. Add a `isResourceBacked` flag to the registry entries that report
   `"resource"`.
3. In `validateProtoFunction`, flag a 2-arg call whose argument 1 is
   resource-backed: *"proto() cannot attach a prototype to a `fs.file` handle -
   this throws at runtime. Only arrays and objects can carry one."*
4. Keep the 1-arg read form silent for every type.
5. Corpus sweep — expect zero hits (no tracked tree does this).

Demo of the current behavior: `zzzz/proto-contract-demo.uc` §4.
