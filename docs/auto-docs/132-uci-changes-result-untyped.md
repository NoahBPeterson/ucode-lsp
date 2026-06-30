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
