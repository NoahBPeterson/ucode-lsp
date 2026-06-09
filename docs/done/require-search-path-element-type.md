# `REQUIRE_SEARCH_PATH` typed as bare `array` instead of `array<string>`

Status: **DONE (0.6.187)** — implemented the one-line fix below + tests
(test-require-search-path-element-type.test.js). Verified vs `/usr/local/bin/ucode`.
Date: 2026-06-08.

## Symptom

```js
for (let pattern in REQUIRE_SEARCH_PATH) {   // REQUIRE_SEARCH_PATH : array  → pattern : unknown
    if (!match(pattern, /\*\.uc$/))          // "Argument 1 of match() is unknown. Use a type guard…"
```

`REQUIRE_SEARCH_PATH` is an array of search-path **strings**, so `pattern` should be `string`
and `match(pattern, …)` should type-check.

## Verified

```
$ ucode -R -e 'for (let p in REQUIRE_SEARCH_PATH) print(type(p), ": ", p, "\n");'
string: /usr/local/lib/ucode/*.so
string: /usr/local/share/ucode/*.uc
string: ./*.so
string: ./*.uc
```

Every element is a `string` (path glob patterns). Same shape as `ARGV` (`array<string>`).

## Root cause

The builtin global is registered with a **bare** array type (symbolTable.ts:508-523):

```ts
this.globalScope.set('REQUIRE_SEARCH_PATH', {
    name: 'REQUIRE_SEARCH_PATH',
    dataType: UcodeType.ARRAY as UcodeDataType,   // ← no element type
    …
});
```

`ARGV`, right above it (symbolTable.ts:456-471), already does it correctly:

```ts
this.globalScope.set('ARGV', { …, dataType: createArrayType(UcodeType.STRING), … });
```

With a bare `array`, the for-in element-type inference has no element to extract → `pattern`
is `unknown`. (Note: this is the *clean* array case, not the union case in
`docs/for-in-union-element-type.md` — once the element type is `string`, the existing for-in
extraction works, since `isArrayType` matches a pure `array<string>`.)

## Fix

```ts
dataType: createArrayType(UcodeType.STRING),
```

One line, mirroring `ARGV`. Then `pattern : string` and `match(pattern, …)` type-checks. No
downstream changes needed — `createArrayType` is already imported/used in this file.
