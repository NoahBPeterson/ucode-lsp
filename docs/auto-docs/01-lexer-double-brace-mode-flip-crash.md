# `}}` / `{{` / `%}` in code flips the lexer into template mode → server crash + silent diagnostic drop

> **STATUS: FIXED in 0.6.196.** Both fixes applied: in raw mode the operator scanner and
> the block-end check no longer treat `{{`/`}}`/`{%`/`%}` as template tags (they lex as
> ordinary brace/percent runs), and `identifyBlock()` is now a loop, not per-char
> recursion. Tests: `tests/test-double-brace-no-template-flip.test.js` (11). Repro file:
> `double-brace-crash-demo.uc`.

**Severity: critical.** A literal `}}` (or `{{`, `%}`) appearing as ordinary code tokens — which happens in *any* nested object/array/closure literal — makes the raw-mode lexer mis-detect a template tag, switch into template mode, and then recurse once per remaining character. On a file larger than ~8 KB after the marker the language-server process **crashes with a stack overflow** (`RangeError: Maximum call stack size exceeded`); on a smaller file it emits bogus parse errors **and silently drops every diagnostic after the marker**.

## Reproduction

Crash (large file), found in the real corpus at `utest/examples/unit/11_mocking_fs_test.uc` (only 301 lines / 10 KB):

```ucode
let cfg = { a: { b: 1 }};   // <-- the `1 }}` is an adjacent `}}`
// ...followed by ~8KB+ of any code...
```

Minimal: `let o = { a: { b: 1 }};` + ~900 trivial statements → server throws `Maximum call stack size exceeded`. The identical file with a space (`{ b: 1 } }`) analyzes fine (901 diagnostics). The crash is **content-triggered, not size-triggered** — `firewall4/.../fw4.uc` (80 KB) is fine because it has no bare `}}`.

Garbage + silent-drop (small file):

```ucode
let o = { a: { b: 1 }};       // <-- false "Expected '}' after object properties" + "Unexpected token"
let bad = undefined_xyz;      // <-- REAL error here is NEVER reported (rest of file swallowed as template text)
```

The everyday trigger is just a nested object literal whose last value is itself an object/array: `{a:{b:1}}`, `return {x:{y:1}};`, `}});`, etc. — `let o = {a:{b:1}};` alone already produces the garbage diagnostics.

## Root cause

`src/lexer/ucodeLexer.ts`:

* Default state is `UC_LEX_IDENTIFY_BLOCK` (template mode); `rawMode` overrides it to `UC_LEX_IDENTIFY_TOKEN`. All call sites pass `rawMode: true`, so scripts *start* in raw mode.
* But `identifyToken()` (lines ~183-194) treats a literal `}}` and `%}` as a template **block-end** tag and sets `this.state = UC_LEX_IDENTIFY_BLOCK`, re-entering template mode mid-stream:

  ```ts
  if (ch === '}' && this.peekChar(1) === '}') { ...; this.state = LexState.UC_LEX_IDENTIFY_BLOCK; return this.emitToken(TokenType.TK_REXP); }
  if (ch === '%' && this.peekChar(1) === '}') { ...; this.state = LexState.UC_LEX_IDENTIFY_BLOCK; ... }
  ```
* Once in `identifyBlock()`, every non-tag character does `this.buffer += this.nextChar(); ... return this.identifyBlock();` — **tail self-recursion with no TCO** (lines ~129-131). N characters of trailing text = N stack frames → overflow.

(`}}` inside a *string*, *regex*, or *comment* literal does **not** trigger it — the string/comment scanners consume those correctly. Only `}}`/`%}` as real tokens flip the state.)

## Fixes

1. In raw mode, never treat `}}`/`%}`/`{{` as template tags (gate the block-tag transitions on `!rawMode`).
2. Convert `identifyBlock()`'s per-character recursion into a loop so template mode itself can't overflow the stack on large text runs.

## Verification

Confirmed against `/usr/local/bin/ucode`: `let o = { a: { b: 1 }};` and `2 ** 3` etc. all run fine — the `}}` is valid ucode, so every diagnostic here is a false positive (or a crash). Crash reproduced through the spawned `node dist/server.js --stdio` server (i.e. the exact runtime VS Code uses).
