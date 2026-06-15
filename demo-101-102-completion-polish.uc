// #101 + #102 — completion polish. Trigger completion (Ctrl+Space) at each spot
// below and look at the item icon + the grey "detail" text to the right of the label.

// ── #101: ambient constants now render with the CONSTANT icon, detail "constant" ──
// Type the start of each name and complete — was Variable icon + "variable":
let a = N;        // NaN, Infinity  → CompletionItemKind.Constant ("constant")
let b = REQ;      // REQUIRE_SEARCH_PATH → Constant ("constant")
// Contrast: ARGV stays a Variable (it's a real mutable global, not a constant).
let c = ARG;      // ARGV → Variable

// ── #102: builtin completions now show a compact signature in `detail` ──
// Complete each — the grey detail is the signature, not the generic "built-in function":
let d = pr;       // printf  → detail "printf(format, ...args)"
let e = sub;      // substr  → detail "substr(string, start, length)"
let f = len;      // length  → detail "length(x)"
// A builtin with no documented params keeps the generic label (no fabricated "()"):
let g = tim;      // time    → detail "built-in function"
