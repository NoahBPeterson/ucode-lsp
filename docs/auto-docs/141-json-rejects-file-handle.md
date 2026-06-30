# `json()` rejects an `fs.file` / proc handle argument, but ucode accepts it

**Severity: low-medium (false positive).** `json()` parses a string OR any object with a `read()` method (a file/proc handle), but the LSP flags `json(filehandle)` as a type error.

## Reproduction

Real corpus: `luci/.../dispatcher.uc:149` `json(open(path, "r"))`; also tailscale.

```ucode
import { open } from 'fs';
let d = json(open('/etc/config.json', 'r'));     // "Function 'json' expects string or object as argument"
```

Verified: `json(open("/tmp/jf.json","r"))` → returns the parsed JSON (exit 0). ucode's `json()` accepts a **string OR any object with a `read()` method** (file/proc/handle) — NOT a plain object (`json({a:1})` errors "does not implement read()"), so the current message wording is also inaccurate.

## Fix

Accept an `fs.file`/`fs.proc`/io-handle (read()-able object) argument to `json()`, and correct the message — `json` wants a *string or a readable handle*, not "string or object" (a plain object is a true positive).
