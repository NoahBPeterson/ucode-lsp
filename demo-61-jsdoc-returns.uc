// #61 @returns — the annotation types the function's return, reconciled SOUNDLY with body
// inference. A JSDoc type is not runtime-checked, so it may only:
//   • FILL an opaque (unknown) body, or
//   • restate / widen an inferred type
// It may NEVER be narrower than what the body provably returns. Anything narrower or
// disjoint is flagged (UC7005, warning) and the INFERRED type is kept.
//
// Every UC7005 below offers a quick fix: "Change @returns to '{<inferred>}'" — it sets the
// annotation to the TRUE inferred return type (the full union of all returns).
//
// (@type on variables is intentionally unsupported — an unverified assertion with no safety
//  floor; for an opaque variable `unknown` is the safe default.)

// ── FILL: an opaque body gets the declared type at every call site ──
/** @returns {string} */
function pick(p) { return p; }     // p unannotated -> body unknown -> @returns fills
let a = pick("x");                 // hover a: string

// ── SOUND: @returns may NOT narrow away a real possibility ──
/** @returns {string} */
function home() {
    return getenv("HOME");         // UC7005: returns 'string|null', which @returns {string} does not cover
}                                  // (write @returns {string|null} to honour it)

// ── contradiction is flagged ON the return statement (per-return) ──
/** @returns {string} */
function bad() {
    return 5;                      // UC7005: returns 'integer', which @returns {string} does not cover
}

/** @returns {string} */
function mixed(x) {
    if (x) return "yes";           // covered — fine
    return 42;                     // UC7005 ONLY here; the matching return above is untouched
}

// ── no return at all -> flagged on the @returns tag (the body returns null) ──
/** @returns {string} */
function stub() { let t = 1; }     // UC7005 on the @returns line: "no return statement (returns null)"

// ── lenient: int/double coerce, so this is NOT flagged ──
/** @returns {double} */
function ratio() { return 5; }     // clean
