# UC1008 "shadows builtin function" fires on very common, idiomatic variable names

**Severity: low (noise).** `UC1008 Variable 'X' shadows builtin function 'X'` is emitted (Warning) whenever a local variable's name matches a builtin. Because ucode has many builtins with everyday English names, this lights up perfectly idiomatic, legal code with warning noise.

## Reproduction

`UC1008` fires on **14 of 17** tested common variable names:

> type, index, length, values, keys, json, split, time, system, push, print, min, max, localtime

```ucode
let index  = 0;                                   // UC1008 shadows index()
let type   = section['.type'];                    // UC1008 shadows type()
let values = split(val, /[ \t]+/);                // UC1008 shadows values() (and split() on the RHS name too)
for (let i = 0, index = 1; i < 3; i++) ...        // UC1008 in a for-loop header
```

Real corpus hits include `firewall4/.../fw4.uc` (`let values = split(...)`) and the `mocklib` fixtures (`index = 0`), 18 occurrences total.

## Why it is noise

Shadowing a builtin is **legal** in ucode and extremely common — `index`, `type`, `length`, `time`, `values` are natural names for loop counters, config fields, and locals, and the shadowing is intentional and harmless within the scope. Verified vs `/usr/local/bin/ucode`: `let index = 0; return index;` runs fine.

## Suggestions

* Demote `UC1008` to a hint, or make it opt-in / configurable.
* At minimum, exclude the most collision-prone everyday names, or only warn when the builtin is *also referenced* in the same scope (so the shadow could actually confuse a reader).
