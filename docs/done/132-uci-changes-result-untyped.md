# `uci.cursor.changes()` result shape is untyped

**Severity: low (inference gap).** `changes()` returns a structured object (per-config arrays of change records), modeled as bare `object | null`.

## Reproduction

```ucode
import { cursor } from 'uci';
let ch = cursor().changes();      // hover: object | null — no inner structure
```

Verified against `ucode/lib/uci.c` (`uc_uci_changes` → `changes_to_uval`, uci.c:1866+, helper ~1755-1810): returns an object keyed by config name, each value an **array of change-record arrays** (`[cmd, section, name?, value?]`, all strings).

## Fix

Model the `changes()` return as `object<string, array<array<string>>> | null` (or a named type). Lower priority than `get_all`/`foreach` (rarely consumed structurally), but the `object | null` model gives no hint of the array-of-arrays shape.

---

## Resolution (2026-07-07): documented shape; full value-typing deferred soundly

C ground truth (ucode/lib/uci.c changes_to_uval/change_to_uval): object keyed by config →
array of [cmd, section, name?, value?] records; elements are strings EXCEPT an "order"
record's value is an integer — so the doc's proposed array<array<string>> was itself wrong.
parseSingleType has no object<K,V> support and forcing it would resolve to unknown (a
regression), so returnType stays `object | null` with the full record shape documented in
the method hover. Residual (object<K,V> parse support) tracked in builtin-return-type-audit.
