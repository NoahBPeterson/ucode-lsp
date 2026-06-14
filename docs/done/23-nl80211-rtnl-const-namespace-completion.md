# `nl80211.const.` / `rtnl.const.` member completion is empty — the constants are unreachable at their only valid path

**Severity: medium (completion).** The `nl80211` and `rtnl` modules expose all their constants under a nested `const` object (`nl80211.const.NL80211_CMD_GET_WIPHY`, `rtnl.const.RTM_NEWLINK`, …). Completing after `nl80211.const.` (or `rtnl.const.`) returns **zero** items, so the constants — which there is no other way to reach — cannot be autocompleted.

## Reproduction

```ucode
import * as nl from 'nl80211';
nl.const.        // completion → 0 items; should list NL80211_CMD_*, NL80211_IFTYPE_*, NLM_F_*, …
```

Same for `rtnl.const.` and for an aliased `let c = nl.const; c.`. (Diagnostics on `nl.const.NL80211_CMD_GET_WIPHY` are clean — the access *type-checks*; only completion is empty.)

## Verified against the C source

`ucode/lib/nl80211.c`: `register_constants()` adds every constant to a fresh object, then `ucv_object_add(scope, "const", c)` (the constants live under `const`, not on the module scope). `ucode/lib/rtnl.c` does the same. So `nl80211.const.X` is the **only** correct access path — and completion there is dead.

## Related (see also finding 24)

The inverse mistake is also present: these same constants are wrongly offered as top-level `import { … } from 'nl80211'` names. The two findings share a root cause — the LSP models nl80211/rtnl constants with the *socket-style* "constants are top-level module members" layout, when in fact they are namespaced under `const`.
