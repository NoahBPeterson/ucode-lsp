# Type-guard quick fix: offered for un-narrowable mismatches + broke on a trailing comment

> **STATUS: FIXED in 0.6.217.** Tests: `tests/test-definite-mismatch-no-guard.test.js` (4).

Two related defects on the `incompatible-function-argument` quick fix, both surfaced
by `f(1)` against `@param {string} x`:

```ucode
/** @param {string} x */
const f2 = function(x) { return substr(x, 0); };
let a = f2(1); // bad
```

## Bug 1 — a guard is offered for a DEFINITE mismatch

"Extract `1` and add type guard" was offered even though the argument is a literal
`1`. A type guard can never rescue it: `type(1) == "string"` is always false, so the
fix produces dead code — and there's no variable to guard in the first place. The
guard pattern only makes sense when the value *might* be the right type (a union with
a valid arm, or `unknown`).

**Fix:** `checkArgumentTypes` (typeChecker.ts) already computes `hasCompatibleType`
(true iff the actual type has a member that could satisfy the contract). It's now
threaded into the diagnostic as `data.narrowable`. `generateTypeNarrowingQuickFixes`
(server.ts) bails for a non-null mismatch when `data.narrowable === false`, so no
guard/extract-guard is offered for a literal or any single provably-wrong type. A
narrowable arg (unknown-typed param, a partially-compatible union) is unaffected.
The flag is absent on other diagnostic emitters → their behavior is unchanged.

## Bug 2 — the extract-to-ternary fix swallowed a trailing comment

Even for a legitimately narrowable value, the top-level "extract + scope-preserving
ternary" branch built the line by regex and captured a trailing `// comment` into the
right-hand side, emitting:

```ucode
let a = type(_val) == "string" ? f2(_val); // bad : null;
```

The `: null;` landed *after* the comment, so the conditional had no `:` →
`Expected ':' after '?' in conditional expression`.

**Fix:** a new string-aware `trailingLineCommentIndex()` (ignores `//` inside
`'`/`"`/backtick strings) splits any trailing comment off before the ternary is
assembled; the comment is re-appended after `: null;`. Result:

```ucode
let _val = maybeNull(3);
let a = _val != null ? split(_val, ",") : null; // keepme
```

(With Bug 1 fixed, the literal case no longer reaches this branch at all; the comment
fix covers the remaining narrowable-at-top-level cases.)

## Audit — do other quick fixes mishandle comments?

After Bug 2, every quick-fix producer (only `server.ts` + `importEdit.ts`) was audited
and empirically fuzzed by applying each offered fix to a comment-bearing version of
its triggering diagnostic, then re-parsing the result. Findings:

- **`generateTypeNarrowingQuickFixes`** — the ternary was the only branch that appended
  code after the (comment-bearing) line content. Every other branch either inserts
  mid-line *before* the comment, or nests the content inside a new block whose closing
  `}` is on a separate line, so the comment is harmless. ✅
- **`findBracelessParent`** — already deliberately strips + re-appends a trailing
  comment, but did so with a naive `/\/\/.*$/` that corrupts a `//` inside a string in
  the control header (`if (sep == "a//b")`). **Hardened** to use the new string-aware
  `trailingLineCommentIndex()`.
- **`generateNullAccessQuickFixes`** (optional chaining, null guard) — operates on AST
  node offsets, not line text. Comment-safe. ✅
- **`generateJsDocQuickFix` / `generateAddImportQuickFix` / `generateImportTypeQuickFix`
  (UC7001) / the UC2009 type-string fix** — insert above the line or replace a precise
  offset range. Comment-safe. ✅
- **`parseOneLinerControl`** — not comment-aware, but its consumers always nest the
  (possibly comment-bearing) body inside a block with `}` on a new line. Safe in use. ✅
- **"Disable ucode-lsp for this line"** — appends ` // ucode-lsp disable` at end of
  line, yielding `code; // foo // ucode-lsp disable` when a comment already exists.
  Functionally fine (one comment; detection is substring-based) but cosmetically a
  double `//`. Left as-is (noted).

Net: the ternary was the only fix that produced broken code; `findBracelessParent`'s
latent string-`//` edge is now closed; all other fixes were already comment-safe.
