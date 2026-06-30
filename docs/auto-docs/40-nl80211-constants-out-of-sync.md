# nl80211 constant set is out of sync — 23 real constants missing → false UC3005

**Severity: low (false positive).** The LSP's nl80211 constant table is missing 23 constants that the module actually registers, so importing/using them produces a false `UC3005 "is not exported by the nl80211 module"`.

## Reproduction

```ucode
import { NL80211_CMD_ABORT_SCAN } from 'nl80211';     // UC3005 + UC1001
import { NL80211_SCAN_FLAG_FLUSH } from 'nl80211';     // same
```

## Verified against the C source

`ucode/lib/nl80211.c` `ADD_CONST(...)` registers 178 constants; `nl80211Constants` in `src/analysis/nl80211Types.ts` has 155. The 23 absent ones include all `NL80211_BSS_STATUS_*`, all `NL80211_SCAN_FLAG_*`, `NL80211_BSS_USE_FOR_*`, `NL80211_BSS_CANNOT_USE_*`, and `NL80211_CMD_ABORT_SCAN`. (No phantom nl80211 constants — the 155 present are all real.)

This is distinct from the documented "nl80211.const completion empty / constants offered as top-level import names" findings: here the actual *set* of constants is incomplete.

## Fix

Regenerate `nl80211Constants` from the C source's `ADD_CONST` list (and, per finding 23/24, relocate them under a `const` namespace rather than top-level). Consider a build-time generator so the table can't drift from `lib/nl80211.c`.
