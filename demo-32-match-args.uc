// ============================================================================
// #32 — match(subject, pattern) is ASYMMETRIC (uncommitted; spot-check).
// Verified vs ucode/lib.c uc_match: `if (ucv_type(pattern) != UC_REGEXP || !subject) return NULL`.
//
//   arg 1 (subject): COERCED to a string  -> match(123, /2/) => ["2"]
//                    => warn (non-strict) / error ('use strict') + "Coerce to string" quick-fix
//   arg 2 (pattern): MUST be a regex; a string is NOT compiled as one
//                    -> match("a1b", "[0-9]") => null  (silently never matches!)
//                    => hard ERROR + "Convert to regex literal" quick-fix
//
// Toggle the leading 'use strict' to see the arg-1 warnings become errors.
// (arg-2 errors are errors in both modes — a non-regex pattern is a real bug.)
// ============================================================================

// 'use strict';

// ── arg 1 (subject) — coerced, like uc/lc: warn + "Coerce to string" fix ──
match("" + 123, /[0-9]/);        // warn: subject 'integer' will be coerced.  QF -> match("" + 123, /[0-9]/)
match(true, /x/);           // warn: boolean coerced // Extract `true` and add type guard: narrows `integer` to `unknown`; please remove this quick fix, and ultrathink better ways to handle this case where we cannot narrow a singular type into a different type (isn't this for unions that include the correct type, and unknowns only?)
match("hello", /l/);        // clean — subject is a string

// ── arg 2 (pattern) — must be a regex: hard ERROR + "Convert to regex literal" fix ──
match("a1b", /[0-9]/);      // ERROR: string pattern never matches in ucode.  QF -> match("a1b", /[0-9]/)
match("path", /a\/b/);       // ERROR.  QF escapes the slash -> match("path", /a\/b/)
match("path", "a\b");       // QF now converts from SOURCE -> /a\b/ (preserves the `\b`, not the
                            // decoded value). NOTE: ucode's regex does NOT support `\b` as a word
                            // boundary anyway (it's POSIX/glibc — `\d`/`\w` work, `\b` does not);
                            // the fix faithfully reproduces what you wrote, it doesn't vouch for it.
match("x", /5/);              // ERROR: number pattern (no quick-fix — not a string)
match("a1b", /[0-9]/);      // clean — a real regex

// ── the asymmetry in one line: subject coerces (lax+nudge), pattern must be regex (strict) ──
let id = 42;
match(id, "[0-9]+");        // TWO diagnostics: warn on `id` (coerce) + ERROR on "[0-9]+" (-> /[0-9]+/)
