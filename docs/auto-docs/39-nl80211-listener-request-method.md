# `nl80211.listener` object is missing its `request()` method → false positive

**Severity: low (false positive).** The listener object returned by `nl80211.listener(...)` has three methods — `set_commands`, `request`, `close` — but the LSP models only `set_commands` and `close`, so calling `.request()` on it falsely errors.

## Reproduction

```ucode
import * as n from 'nl80211';
let l = n.listener(() => {}, [1]);
l.request(1, 2, {});       // "Method 'request' does not exist on nl80211.listener"
```

## Verified against the C source

`ucode/lib/nl80211.c`: `listener_fns[] = { set_commands, request, close }`. `src/analysis/nl80211Types.ts` `listenerMethods` has only `set_commands` and `close`. (The sibling `rtnl` listener is correctly modeled — its C `listener_fns` really is just `set_commands` + `close`.)

## Fix

Add `request` to `listenerMethods` in `nl80211Types.ts`.
