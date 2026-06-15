> ✅ **FIXED 0.6.248.** Builtin completion items now carry a compact signature in `detail` (e.g. `printf(format, ...args)`, `substr(string, start, length)`, `length(x)`) instead of the generic `"built-in function"`. New `compactBuiltinSignature(name, doc)` in `signatureHelp.ts` reuses the SAME `**Parameters:**` parsing signature-help uses (preferring a leading `**name(sig)**` line when present). When the doc carries no parameter signal (paramless/constant entries like `time` or the `NL80211_*` constants mis-listed in the builtin map) it returns null and the item keeps the generic detail — no fabricated `name()`. Tests: `test-completion-kind-and-detail.test.js`.

# Builtin-function completion items carry no signature in `detail`

**Severity: low (completion polish).** A builtin's completion item shows `detail: "built-in function"` (generic); the actual signature lives only inside the expandable `documentation` markdown.

## Reproduction

Complete `printf` → `detail: "built-in function"`. Expected a compact signature, e.g. `printf(format, ...args)`, so it shows inline in the completion list without expanding docs.

## Notes

The data exists — the doc strings in `src/builtins.ts` carry a `**Signature:**` / parameter list, and `signatureHelp.ts` already extracts a first-line summary — but it isn't surfaced into the completion item's `detail`. Purely a polish gap.

## Fix

Populate each builtin completion item's `detail` with a compact signature derived from the same source signature-help uses.
