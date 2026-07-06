# Shorthand method declarations in object literals (new ucode `main` syntax)

Status: **NOT STARTED — 🟢 LOW PRIORITY.** The feature isn't in any OpenWrt release pin yet (not
even main's `3ec4e5c`), so no real deployed script uses it — revisit when a release bumps its
ucode past `fecacb8`. Reviewed 2026-07-05 across `ucode-upstream.json` (`3ec4e5c`) → `ucode/`
`origin/master` (`fecacb8`).

## TL;DR

ucode upstream added **shorthand method declarations** in object literals — `{ foo() { … } }`
as sugar for `{ foo: function() { … } }` — in **`fecacb8`** (PR #387 "syntax-method-support",
merged **2026-06-22**). The LSP parser does **not** parse it yet: `let o = { foo() {} };` produces
`UC6002` "Expected '}' after object properties" plus a cascade. This is the only LSP-relevant
grammar change in the range (the other commits are internal `ioctl` platform support — see the
end).

## The syntax (from `tests/custom/00_syntax/29_method_shorthand`)

```ucode
obj = {
    foo() { return 42; },                      // basic
    add(a, b) { return a + b; },               // parameters
    sum(...args) { … },                        // rest parameter
    name: "test",                              // mixed with regular properties
    greet() { return "Hello, " + this.name; }, // `this` binds to the object
    outer() { return { inner() { … } }; },     // nested
    ...base,                                    // alongside spread
    [key]() { return "bar"; },                 // computed method name
};
```

Every form is `key: function(...) { ... }` under the hood — the value is an anonymous function
whose name is taken from the key. `this` inside the method resolves to the receiver object.

### What still errors (negative cases — the LSP must NOT accept these)

| source | ucode error |
|---|---|
| `{ foo() }` | `Unexpected token, Expecting '{'` — a method requires a `{ … }` body |
| `{ foo(123) { … } }` | `Unexpected token, Expecting Label` — params must be identifiers, not literals |
| `{ return() { } }` | `Invalid identifier` — a keyword cannot be a method name |

(A keyword *can* still be a normal property key: `{ return: 1 }` is valid — the restriction is
specific to the method-name position, mirroring `uc_compiler_compile_method`'s keyword check.)

## Provenance & version gating — the subtle part

The feature is in ucode **upstream master** but **not yet in any OpenWrt release's ucode pin**
(each release's `package/utils/ucode/Makefile` `PKG_SOURCE_VERSION`, re-checked 2026-07-05):

| OpenWrt | pinned ucode | date | has shorthand methods? |
|---|---|---|---|
| 24.10 | `3f64c808` | 2025-07-18 | ✗ |
| 25.12 | `85922056` | 2026-01-16 | ✗ |
| main | `3ec4e5c` | 2026-06-03 | ✗ (this **is** `lastSupportedCommit`) |
| ucode upstream master | `fecacb8` | 2026-06-22 | ✓ |

So even OpenWrt **main** currently pins a ucode that predates `fecacb8`. The LSP's `'main'`
target models the **newest ucode grammar** (`UCODE_SNAPSHOT_DATES.main = 'newest'`, and the
existing `exportFunctionNoSemicolon` is `introducedIn: 'main'`), so the consistent model is:

> **`introducedIn: 'main'`** — parse it on every target (recover, don't hard-error), and flag
> **UC6005** on any target below `main` (i.e. 24.10 / 25.12): *"shorthand method declarations were
> added in {INTRO}, but the target is {target}; use `key: function() {…}`."*

Caveat to weigh at implementation time: because OpenWrt main's Makefile still pins pre-`fecacb8`
ucode, `'main'` here is optimistic (bleeding-edge grammar, ahead of the deployed pin) — the same
stance the LSP already takes for `exportFunctionNoSemicolon`. If we'd rather not surface a
grammar feature no release ships yet, the alternative is to add the parser support now but keep
it flagged on **all** current targets until an OpenWrt release bumps its ucode pin past `fecacb8`
(then relax the floor). Recommend matching the existing `'main'` convention.

## Implementation plan

1. **Parser — `parseObject`** (`src/parser/expressions/compositeExpressions.ts:63`). Two insertion
   points:
   - Identifier-key branch (~line 101): after reading the key token, before the shorthand-property
     path (the `!this.check(TK_COLON)` at ~line 107), add `if (this.check(TokenType.TK_LPAREN))` →
     parse a shorthand method: build a `FunctionExpression` (id = the key name, params via the
     existing param parser, body via `parseBlockStatement`) and push a `Property` whose `value` is
     that function. Reject a keyword key here (mirror `canUseAsIdentifier`/the ucode "Invalid
     identifier" case).
   - Computed-key branch (~line 97): after `consume(TK_RBRACK)`, add the same `TK_LPAREN` check →
     computed shorthand method (Property `computed: true`, `value` = the function, key = the
     bracket expression).
   - Reuse the function-expression param/body parsing already used elsewhere so rest params
     (`...args`) and the "params must be identifiers" / "body required" errors come for free.
2. **AST — `PropertyNode`** (`src/ast/nodes.ts:156`): add `method?: boolean` (true for shorthand
   methods) so downstream passes (hover, `@param` JSDoc attachment, go-to-def, method inference)
   can tell a method from a function-valued property. `getChildNodes` already visits `value`.
   Propagate `propJsDoc` onto the function value (the existing code path at ~line 90 does this for
   `key: function(){}`; shorthand should behave identically so `@param` still attaches).
3. **Version feature** (`src/analysis/ucodeVersions.ts`): add a `VERSION_FEATURES.shorthandMethod`
   entry (`introducedIn: 'main'`, label "A shorthand method declaration `{ foo() {…} }`", remedy
   "use `foo: function() {…}`"), and call `this.flagVersionFeature(VERSION_FEATURES.shorthandMethod,
   start, end)` at the parse site (anchored on the method key), following `exportFunctionNoSemicolon`.
4. **`ucode-upstream.json`**: bump `lastSupportedCommit` to `fecacb8` (and `lastChecked`) once
   shipped — the marker that the LSP grammar is caught up to this ucode commit.
5. **Tests**: the positive forms (basic/params/rest/mixed/nested/spread/computed), `this` binding,
   `@param` JSDoc on a shorthand method, hover showing the method signature, and the three negative
   cases still erroring. Version test: UC6005 on 25.12, clean on `main`. Consider a demo `.uc`.

## Not actionable this round — `ioctl` (macOS + older-linux)

`395bb88`/`1692969`/`8c9ba83`/`20a2ae4` add macOS (`mac_ioctl_cmd`) and older-linux `ioctl`
support in `lib/io.c` / `lib/fs.c`. These are **internal platform `#ifdef`s only** — the
ucode-facing `ioctl` function, its signature, and the `IOC_DIR_*` constants are unchanged (no new
`uc_function_list` entry or `ADD_CONST`). No LSP change needed; noted here so the review is
complete.
