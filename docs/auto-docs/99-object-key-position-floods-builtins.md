# Object-literal KEY position floods with builtins and global constants

**Severity: low (completion).** Completing an object-literal key offers 91 items (global constants sorted to the very top, then builtins) — noise for what is a fresh identifier, and a bad-commit risk.

## Reproduction

```ucode
let o = { p };     // completion → ARGV, global, Infinity, modules, NaN, REQUIRE_SEARCH_PATH, then builtins
```

An object key is a new identifier (or a known property name in some refactors); the global builtin/constant list is irrelevant there and, as with finding 98, risks accepting a builtin name by mistake.

## Fix

Detect the object-literal key position and suppress the global builtin/constant flood (offer nothing, or only relevant known keys if a target shape is inferable).
