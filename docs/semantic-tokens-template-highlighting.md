# Semantic-token highlighting for templates (planned)

Status: **planned, not built** (investigated 2026-06-21). The motivating bug is real and
demonstrated; the fix is a server-side semantic-tokens provider.

## The problem

ucode's mode is **invocation-determined** (`utpl` / `ucode -T` = template; `ucode` / `-R` =
raw; default raw), both modes use the `.uc` extension, and there is **no `.ut` convention**.
In a TEMPLATE file, everything outside `{% … %}` / `{{ … }}` is literal output text — so a
`//` out there is **not a comment, it prints**. Example (run with `utpl`):

```
{% let greeting = "hi"; print(greeting); %}
//value={{ nope }}
```

The second line is template TEXT: it prints `//value=` followed by the rendered `{{ nope }}`.
It only *looks* commented out.

Our TextMate grammar (`syntaxes/ucode.tmLanguage.json`) colors that whole line as a comment,
making live output read as inert — a genuine miscolor.

## Why the grammar alone cannot fix it

The grammar is **raw-first**: the root context applies `#comments` (`//.*$`), `#strings`,
`#keywords`, `#numbers`, … to the *entire* file, and `#template_blocks` only wraps
`{% %}`/`{{ }}` in a meta scope while recursively `include`-ing `$self`. There is no
"template text" scope, so text-outside-blocks is highlighted as code.

TextMate grammars are static, line-stateful tokenizers with **no global lookahead** — they
cannot run our `detectTemplateMode` (which inspects the shebang and scans for tags after
stripping strings/comments). The two single-grammar options each break the other mode:

- **Raw-first** (current): raw files perfect; template **text** miscolored.
- **Template-first**: templates better; every **raw** file loses top-level code
  highlighting (unacceptable — raw is the common case).

So a correct, mode-aware fix has to live where the mode is actually known: the language
server.

## The fix: an LSP semantic-tokens provider

The server already computes the mode (`detectTemplateMode`, `src/lexer/templateMode.ts`) and
already lexes/bridges templates (`bridgeTemplateTokens`). A semantic-tokens provider can
emit mode-aware tokens that the editor layers **on top of** the TextMate grammar, correcting
exactly the text-vs-code regions:

- **For a template file** (`detectTemplateMode(text) === true`):
  - mark every TEXT span (the dropped `TK_TEXT` regions — outside all blocks) with a
    non-code token type (e.g. `string`, or a custom `templateText` modifier) so `//`, `for`,
    digits, etc. in that span are NOT colored as code/comments;
  - mark the tag delimiters (`{%`/`%}`/`{{`/`}}`/`{#`/`#}`, incl. trim modifiers) distinctly;
  - leave code INSIDE blocks to the normal grammar (or tokenize it too, for consistency).
- **For a raw file**: emit nothing (or only what improves raw highlighting) — the grammar is
  already correct, so the provider must not regress it.

Semantic tokens take precedence over TextMate scopes for the ranges they cover, so this
overrides the miscolor without fighting the grammar.

### Implementation sketch

1. **Client capability** — register `semanticTokensProvider` in the server `initialize`
   result with a legend (token types: at least `comment`, `string`, `keyword`, `variable`,
   `operator`, plus a delimiter type; modifiers optional). Add `documentSelector` for `ucode`.
2. **Token source** — the lexer already produces `TK_TEXT` (template text) and the tag tokens
   that `bridgeTemplateTokens` drops/rewrites. Add a path that returns the *raw* template
   token stream (pre-bridge) with offsets, so the provider can see the TEXT spans and tag
   delimiters it needs. (The bridge intentionally discards these for the parser; the provider
   needs them, so expose them rather than re-deriving.)
3. **Encoding** — emit the LSP delta-encoded `(deltaLine, deltaStartChar, length,
   tokenType, tokenModifiers)` quintuples, sorted by position. Use the document's existing
   `positionAt` for line/char.
4. **Mode gate** — compute `detectTemplateMode(text)` once; only emit template-text/delimiter
   tokens when true. Raw files return an empty (or minimal) set.
5. **Range variant** — implement `semanticTokens/range` too, so large templates only
   recompute the visible window.

### Tests

- Unit: for the demo above, assert the `//value=…` span is emitted as template-text (not
  comment) and the `{{ }}` delimiters are tagged; assert a raw file with a real `//` comment
  emits nothing template-specific (no regression).
- Oracle parity is not applicable to coloring, but the TEXT-vs-code partition can be checked
  against `bridgeTemplateTokens` (the spans it drops == the TEXT spans the provider paints).
- Reuse the `demos/template-strict/` files (esp. the `//`-in-text case) as fixtures.

## Risks / notes

- Semantic tokens are **additive**: theme support varies, and some scopes may need a
  `semanticTokenScopes` mapping in the client `package.json` contribution so default themes
  pick them up.
- Keep the provider cheap: it shares the lexer with diagnostics; cache per document version.
- This does not change diagnostics — purely presentation. The diagnostic side (strict-aware
  severity, nested/unterminated/`+%}` rejection) is already handled in the lexer/analyzer.

## Related

- `docs/ucode-template-mode-support.md` — the template front-end (lexer/parser/mode detection,
  strict handling, the rejection diagnostics).
- `demos/template-strict/` — runnable, oracle-verified template examples (incl. the
  `//`-in-text miscolor case).
