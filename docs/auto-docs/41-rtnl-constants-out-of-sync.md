# rtnl constant set is badly out of sync — 154 real constants missing **and** 81 phantom constants accepted

**Severity: low-medium.** The LSP's rtnl constant table both omits real constants (false positives) and includes constants the module never exports (false negatives).

## A. 154 real constants missing → false UC3005

```ucode
import { FR_ACT_GOTO } from 'rtnl';       // UC3005 "is not exported by the rtnl module"
import { IFA_F_PERMANENT } from 'rtnl';    // same  (also GRE_KEY, FIB_RULE_INVERT, GENEVE_DF_SET, GTP_ROLE_SGSN, HSR_PROTOCOL_*, …)
```

`ucode/lib/rtnl.c` `ADD_CONST(...)` registers 311 constants; `rtnlConstants` in `src/analysis/rtnlTypes.ts` lists 238, of which 81 are phantoms (see B), so net real coverage is 157 — **154 real constants are missing**.

## B. 81 phantom constants accepted → false negative

```ucode
import { RTA_DST } from 'rtnl';       // accepted (no error) — but RTA_DST is NOT a module export
import { RTA_GATEWAY } from 'rtnl';    // accepted
```

The phantoms are `RTA_*` (31), `RTPROT_*` (22), `TCA_*` (8), `RTNH_*` (7), `RTEXT_*` (7), plus a few others — these are internal C attribute/field identifiers used inside rtnl.c structs. `grep -c 'ADD_CONST((RTA_|RTPROT_|TCA_|RTNH_|RTEXT_)' lib/rtnl.c` = **0**; none are registered into the module scope, yet `rtnlConstants` lists them, so `import { RTA_DST } from 'rtnl'` is wrongly accepted.

## Fix

Regenerate `rtnlConstants` strictly from the `ADD_CONST` calls in `lib/rtnl.c` (dropping the 81 phantoms, adding the 154 real ones), and relocate under a `const` namespace per findings 23/24. A build-time generator would prevent this drift.
