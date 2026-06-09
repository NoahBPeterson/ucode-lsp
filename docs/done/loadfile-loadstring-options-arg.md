# `loadfile()` / `loadstring()` reject the optional `options` argument

Status: **DONE (0.6.191)** — both validators accept 1-2 args + type the 2nd as an object;
hover docs updated; and the options object autocompletes the full ParseConfig key set
(detectParseConfigOptionsContext + createParseConfigCompletions in completion.ts). Tests
test-loadfile-loadstring-options.test.js (14). Verified vs `/usr/local/bin/ucode` and ucode
C source. Date: 2026-06-08.

## Symptom

```js
loadfile("./templates/example.uc", { raw_mode: true });
// → loadfile() expects 1 argument, got 2     (false positive)
```

Both `loadfile` and `loadstring` take an **optional second `options` argument** (a
`ParseConfig` object). The LSP hardcodes exactly one arg and errors on two.

## Evidence

ucode C source (`uc_loadfile`):

```c
// @param {string} path                          — the file to compile
// @param {module:core.ParseConfig} [options]    — compilation options (OPTIONAL)
source = uc_source_new_file(ucv_string_get(path));
return uc_load_common(vm, nargs, source);        // forwards ALL nargs, incl. options
```

`loadstring` is `loadstring(code[, options])` with the same `ParseConfig` second arg
(`uc_loadstring` → `uc_load_common`).

Interpreter check (verified):

```js
let f = loadstring("return 1+1;", { raw_mode: true });
print(f(), "\n");   // → 2     (2-arg form accepted, no error)
```

`ParseConfig` is an object with keys like `lstrip_blocks`, `trim_blocks`,
`strict_declarations`, `raw_mode`.

## Root cause

`checkers/builtinValidation.ts` — both validators gate on `length !== 1`:

```ts
validateLoadfileFunction(node) {
  if (node.arguments.length !== 1) {                       // ← rejects the valid 2-arg form
    this.errors.push({ message: `loadfile() expects 1 argument, got ${…}`, … });
    return true;
  }
  …
  this.validateArgumentType(arg, 'loadfile', 1, [UcodeType.STRING]);
}

validateLoadstringFunction(node) {
  if (node.arguments.length !== 1) {                       // ← same bug
    this.errors.push({ message: `loadstring() expects 1 argument, got ${…}`, … });
    …
  }
}
```

## Fix design

Accept 1–2 args and validate the optional second as an object:

```ts
if (node.arguments.length < 1 || node.arguments.length > 2) {
  this.errors.push({ message: `loadfile() expects 1-2 arguments, got ${node.arguments.length}`, … });
  return true;
}
// arg 0: path/code (string) — unchanged, keep narrowForArgType for loadfile
if (node.arguments[1]) {
  this.validateArgumentType(node.arguments[1], 'loadfile', 2, [UcodeType.OBJECT]);
}
```

Apply the same change to `validateLoadstringFunction`. This mirrors the existing
`validateIncludeFunction`, which already does the `1..2` arity + `[STRING, OBJECT]` shape
correctly — use it as the template.

### Secondary: hover docs omit `options`

`builtins.ts:49-50` document only the first parameter for both functions. Add the optional
`options` (ParseConfig) param to both hover strings while fixing the validator, so signature
help and hover match the real API.

### Payoff

No more false "expects 1 argument, got 2" on the documented `loadfile(path, options)` /
`loadstring(code, options)` calls (e.g. template precompilation with `{ raw_mode: true }`).
