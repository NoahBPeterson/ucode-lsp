# nl80211/rtnl constants are offered as top-level `import { }` names and import without error (they are not exported)

**Severity: medium.** The `import { … } from 'nl80211'` (and `'rtnl'`) completion offers every constant (`NLM_F_ACK`, `NL80211_CMD_*`, `RTM_NEWLINK`, …) as an importable name, and `getDiagnostics` reports **no error** when one is imported — but these constants are not top-level exports of those modules.

## Reproduction

```ucode
import { NLM_F_ACK } from 'nl80211';     // no error; offered by completion
import { RTM_NEWLINK } from 'rtnl';      // no error; offered by completion
```

`import {` completion offers ~160 names for `nl80211` / ~245 for `rtnl`, including all the bare constants. The only real top-level exports are `error, request, waitfor, listener, const` (nl80211) and `error, request, listener, const` (rtnl).

## Verified against the C source

For `nl80211`/`rtnl`, `ADD_CONST(x)` targets the **nested** `const` object, not `scope` — so the constants are reached as `nl80211.const.X`, never imported directly (see finding 23). For `socket`/`io`/`log`/`zlib`/`ubus`, by contrast, `#define ADD_CONST(x) ucv_object_add(scope, …)` targets the module scope directly, so *their* constants legitimately are top-level (confirmed against the interpreter for socket).

The LSP applies the socket-style "constants are top-level" model uniformly, which is correct for socket/io/log/zlib/ubus but wrong for the two `const`-namespaced modules.

## Fix

Model nl80211/rtnl constants as members of a `const` namespace object (fixing both this and finding 23), and remove them from the modules' top-level import/valid-export set so that `import { NLM_F_ACK } from 'nl80211'` is correctly flagged.
