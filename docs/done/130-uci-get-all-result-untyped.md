# `uci.cursor.get_all()` result is an untyped `object` — the section/package shape is lost

**Severity: low-medium (inference gap).** `get_all` returns a concrete, well-known section shape, but the LSP models it as bare `object | null`, so there's no completion/typing for the standard `.type`/`.name`/`.anonymous`/`.index` keys or option values.

## Reproduction

```ucode
import { cursor } from 'uci';
let c = cursor();
let sec = c.get_all('network', 'lan');
let t = sec['.type'];    // no type/completion
let p = sec.proto;       // option value — no type
```

Verified against `ucode/lib/uci.c` (`uc_uci_get_all` → `section_to_uval`, uci.c:541-564): builds an object with keys `.anonymous` (boolean), `.type` (string), `.name` (string), `.index` (integer, when ≥0), plus one key per option (string for `UCI_TYPE_STRING`, `array<string>` for `UCI_TYPE_LIST`). The 1-arg form returns a package: an object keyed by section name.

## Fix

Model a `uci.section` object-type with the fixed `.anonymous`/`.type`/`.name`/`.index` keys (+ a permissive index signature for options) and use it as `get_all`'s return. (Shares the shape with `foreach`'s callback — finding 131.)
