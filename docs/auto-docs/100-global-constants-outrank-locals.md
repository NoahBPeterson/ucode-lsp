# Ambient global constants are ranked in the same tier as user locals and sorted above them

**Severity: low (completion ordering).** User-declared locals are buried among rarely-wanted ambient globals because both share a `0<name>` sortText and sort alphabetically.

## Reproduction

```ucode
let myLocal = 1;
// complete on the next line →
// ARGV  global  Infinity  modules  myLocal  NaN  REQUIRE_SEARCH_PATH  ...
```

`myLocal` lands at rank 4, behind `ARGV`/`global`/`Infinity`/`modules`. The ambient globals come from the global scope in `symbolTable.ts` (~456+) and flow through the generic `case 'variable'` path (`completion.ts:666`) getting `sortText: 0${name}`, identical to user locals.

## Fix

Give user-declared locals a higher-priority `sortText` tier than ambient builtin globals (e.g. prefix locals `0`, globals `1`), so the names the user just wrote rank first.
