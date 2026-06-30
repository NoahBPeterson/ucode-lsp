# `// ucode-lsp disable` only *downgrades* severity, has no next-line/file form, and self-flags when unused

**Severity: medium (UX).** The single diagnostic-suppression directive has three user-hostile behaviours.

## 1. It downgrades, it does not suppress

```ucode
let y = undefined_zzz; // ucode-lsp disable
```

The `UC1001` error is reduced from **Error → Warning**, and `UC1006` from Warning → Info. The diagnostics still appear in the Problems panel — just one severity lower. Users reasonably expect "disable" to *remove* the diagnostic, not demote it.

## 2. No `disable-next-line`, no file-level, no rule-specific disable

```ucode
// ucode-lsp disable-next-line
let y = undefined_zzz;     // NOT suppressed — the directive does nothing
```

Only an exact same-line `// ucode-lsp disable` (or its heuristic multi-line-statement range) is recognized. The near-universal ESLint-style `disable-next-line` is silently ignored, and there is no way to disable a whole file or a specific rule code.

## 3. A disable comment that matches nothing becomes a new diagnostic

```ucode
let mocklib = global.mocklib; // ucode-lsp disable   // <-- "No diagnostic disabled by this comment"
```

If the line has no diagnostic to act on, the LSP emits `No diagnostic disabled by this comment`. So adding a disable comment defensively (or leaving one after you fix the underlying issue) **creates** a warning. This fires **41 times** across the `*/tests/lib/mocklib/*.uc` files in the corpus, where authors clearly tried to silence the LSP.

The check is also imprecise: it credits only the exact comment line, not the multi-line statement range the comment legitimately suppressed, so a working multi-line disable can still be reported as "unnecessary".

## Source

`src/analysis/semanticAnalyzer.ts` — `parseDisableComments`, `shouldReduceSeverity` (reduces, never removes), `checkUnnecessaryDisableComments` (emits the "No diagnostic disabled" message). `src/server.ts:411` — the only recognized literal is `// ucode-lsp disable`.
