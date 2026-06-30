# Property access on an `fs.proc`-typed value is reported as "Method 'X' does not exist on fs.proc"

**Severity: low.** Reading a non-method property on a resource handle (fs.proc/fs.file) is reported as a missing **method**, and ucode resource handles actually permit arbitrary property reads (returning null), so it shouldn't error at all.

## Reproduction

Real corpus: `luci-app-tailscale-community/.../tailscale.uc:74-83` — `p?.TailscaleIPs`, `p?.OS`, `p?.Online` (here `p` is mis-typed as `fs.proc` — see finding 05 — but the reporting itself is wrong):

```ucode
import { popen } from 'fs';
let p = popen('cmd');
let x = p.OS;          // "Method 'OS' does not exist on fs.proc"  — it's a property read, not a method call
```

Verified: a ucode resource handle permits arbitrary property reads (returns null), and the message says "Method" for what is property access.

## Fix

For a resource/object-handle type, (a) distinguish property *read* from method *call* in the message ("property" not "Method"), and (b) since handles permit arbitrary property reads returning null, don't hard-error on an unknown property read on a resource handle. (The upstream mis-typing of a JSON object as `fs.proc` is the separate finding 05.)
