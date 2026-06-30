# `uci.cursor.foreach()` callback parameter is completely untyped

**Severity: low-medium (inference gap).** `foreach` — the dominant UCI iteration idiom — passes a section object to its callback, but the callback parameter is left untyped, so its known `.type`/`.name`/option fields get no assistance.

## Reproduction

```ucode
import { cursor } from 'uci';
let c = cursor();
c.foreach('network', 'interface', (sec) => {
    sec['.type'];   // hover sec: <none>; no type/completion
    sec.proto;
});
```

Verified against `ucode/lib/uci.c` (`uc_uci_foreach`, uci.c:1979-1980): pushes exactly `section_to_uval(vm, sc, i-1)` as the sole callback argument — the same section object as `get_all` (finding 130), with `.anonymous`/`.type`/`.name`/`.index` + options. The LSP's own JSDoc port even documents "will receive a section dictionary as sole argument," but the callback parameter type isn't propagated.

## Fix

Type `foreach`'s callback parameter 0 as the `uci.section` shape (finding 130). This is the single highest-value uci gap — `foreach` is the primary UCI iteration pattern in OpenWrt code.
