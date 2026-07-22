# Parser-fidelity gaps vs. real ucode, round 2 — from tree-sitter-ucode v0.7.0..v0.8.0

> ✅ **RESOLVED (filed 2026-07-21, shipped 0.7.72).** All five fixed: numeric object keys
> (UC6018), empty import/export lists (UC6019), multi-line regex literals (lexer), leading-`]`
> character classes (lexer), plus the `import {}` → "Undefined variable: from" cascade.

> **Credit — REQUIRED IN EVERY COMMIT.** Every issue below was found by
> **[`m00qek`](https://github.com/m00qek)** on GitHub while building
> [`tree-sitter-ucode`](https://github.com/m00qek/tree-sitter-ucode) — this round by diffing
> their v0.7.0..v0.8.0 fidelity fixes against our lexer and parser. **Any commit that fixes,
> partially fixes, or touches any item in this document MUST credit them**, e.g.:
>
> ```
> Reported-by: m00qek (https://github.com/m00qek)
> Co-authored-by: m00qek <m00qek@users.noreply.github.com>
> ```
>
> See `docs/done/m00qek-parser-fidelity.md` for round 1 (UC6008–UC6013, 0.7.40–0.7.45).

**Verification method.** Every claim below was executed against a build of the vendored
`ucode/` tree (`cmake --build ucode/ --target ucode`, commit `3ec4e5c`), *not* only read off
the C source. Note that the `ucode` on `PATH` is a different, older build and is not a valid
oracle; the `~/.local/bin/ucode_{main,24_10,23_05,22_03}` per-release oracles are currently
broken (`dyld: Library not loaded: @rpath/libucode.0.dylib` — their `/tmp/ucbuild-*` staging
dir was purged) and need `scripts/build-ucode-oracles.sh` re-run.

---

## 1. Numeric object keys accepted — `{1: 2}` (UC6018)

**ucode**: `Syntax error: Expecting label`, rc=255. The object-literal parser
(`compiler.c:2246-2250`) matches only `TK_LABEL` or `TK_STRING` at the key position; a
computed `[1]: …` key is the escape hatch and is unaffected.

**LSP (was)**: `compositeExpressions.ts` accepted `TK_NUMBER`/`TK_DOUBLE` and coerced them to
string keys, silently.

**Fix**: report UC6018 and keep parsing the property as a string key, so the rest of the
literal still types and hovers. Reported via `selfContainedErrorAt` (see §6) so every bad key
in one literal gets its own diagnostic.

## 2. Empty import / export lists accepted — `import {}` / `export {}` (UC6019)

**ucode**: both list parsers are `do { … } while (match(TK_COMMA))` loops
(`uc_compiler_compile_exportlist`, `compiler.c:3300-3307`; the import list at `:3770-3790`),
so they demand a first specifier *before* they ever check for `}`. Oracle-verified in real
module context (an importer driving a module file, with a known-good baseline module proving
the harness): `export {};` → "Expecting Label"; `import {} from "./m.uc"` → "Expecting Label,
String or 'default'".

**LSP (was)**: `export {}` accepted silently; `import {}` errored, but only by accident and
with the wrong message (below).

**Fix**: UC6019 at all three sites (named imports, named imports after a default import,
export list).

## 3. `import {} from "…"` cascaded into a bogus undefined-variable report

Empty braces produced zero specifiers, so `parseImportDeclaration`'s
`specifiers.length > 0 && !match(TK_FROM)` guard skipped the `from` check entirely and fell
through to the bare side-effect-import path (`import "module";`). That reported
`Expected string literal after 'from'` anchored on the `from` token, bailed out, and left
`from` to be re-parsed as an expression — yielding `UC1001: Undefined variable: from`.

**Fix**: track `sawBindingSyntax` so an empty-braced import is still treated as a binding form
and still expects `from`.

## 4. Multi-line regex literals rejected — FALSE POSITIVE

```ucode
let r = /foo
bar/;              // valid ucode (oracle rc=0, prints /foo\nbar/) — we emitted 4 errors
```

**ucode**: `parse_regexp` calls `parse_string(lex, '/')` (`lexer.c:490-497`) — the *same*
routine as string literals — so raw newlines are ordinary pattern content and only EOF makes a
regex unterminated.

**LSP (was)**: `parseRegex` bailed on the first line break with "Unexpected token '/'. Did you
mean to use a comment '//'?", which then cascaded.

**Fix**: scan through newlines. The reason the bail existed — an unterminated `/` otherwise
swallowing the file into one error token — is handled by *rewinding* at EOF to just past the
opening slash and reporting the stray-slash error there, so recovery stays line-local. This is
the same tradeoff m00qek resolved with an external scanner token that returns false at EOF.

**Known remaining divergence**: a regex whose *first* character is a raw newline (`/\nfoo/`)
is still reported as a stray slash, because the pre-scan lookahead treats `/`-then-newline as a
typo. Deliberate: that heuristic catches a real and common mistake, and a regex starting with a
literal newline is vanishingly rare.

## 5. A leading `]` in a character class closed the class — FALSE POSITIVE

```ucode
let a = /[]/]/;    // valid ucode (oracle rc=0) — we errored
let b = /[^]/]/;   // same
```

**ucode**: the lexer (`lexer.c:386-393`) reads an optional leading `^` and then an optional
leading `]` as *literal* members before it starts looking for the class terminator, so
`[]…]` and `[^]…]` do not close at that first `]`.

**LSP (was)**: `parseRegex`'s `inCharClass` flag flipped off at the leading `]`, so a following
`/` was mistaken for the regex terminator.

**Fix**: after consuming `[`, consume an optional `^` then an optional `]` as literal content.

> Note: `/[]]/` and `/[^]a]/` happened to parse cleanly before this fix, by luck — the class
> closed early but the *next* `]` was then treated as ordinary content and the real terminator
> still lined up. Only a class containing an unescaped `/` exposed the bug. Probe with
> `/[]/]/`, not `/[]]/`.

## 6. New parser primitive: `selfContainedErrorAt`

`errorAt` latches `panicMode` so one bad token can't spray a file with knock-on errors, which
also means only the *first* of several independent errors in a statement is reported.
`lexerErrorAt` already opted out of the latch for lexer errors, on the grounds that they are
self-contained. UC6018 has the same property — the offending token is consumed and the parse
continues in exactly the state a valid key would have reached — so `selfContainedErrorAt`
generalizes that escape hatch to parse diagnostics that provably carry no cascade risk.

**Use it only when that holds.** The panic latch is what keeps recovery sane.

---

## Checked and already correct (no action)

Verified against the same oracle, all matching ucode already: octal escapes above `\377`
(UC6013 rejects `\400`/`\777` with no maximal-munch leak), ASI before the binary `in` keyword,
`**` left-associativity (`2 ** 3 ** 2` → 64, not JS's 512), leading-zero number rules
(`0123`→83, `08`→8, per `uc_number_parse_octal`), ASCII-only identifiers, `/*/` as a complete
empty comment (UC6017), `try` requiring `catch`, raw newlines inside string literals, and
statement-position `{a: 1};` (we reject it, matching ucode; m00qek's grammar deliberately
accepts it as a semantic-only rejection). Single-char JSDoc types (`@param {T}`) work given a
matching `@template T`, so their ucdocs regression does not apply to us.

## Deliberate divergence from tree-sitter-ucode: `a++ / b`

ucode rejects `a++ / b` (`Syntax error: Unterminated string`, rc=255) because `lexer.c` never
sets `no_regexp` after a postfix `TK_INC`/`TK_DEC`, so the `/` opens a regex. m00qek documented
this as an upstream ucode bug and deliberately did *not* emulate it — correct for a grammar.
We are a linter, so the opposite call is arguably right: this is code that will not compile on
the target and we are currently silent on it. **Not implemented; open question.** If taken, it
wants a quick-fix that parenthesizes (`(a++) / b`).
