// ============================================================================
// #34 localtime/gmtime  &  #35 hexenc  (uncommitted; spot-check)
// Toggle the leading 'use strict' to see the warnings flip to errors.
// ============================================================================

'use strict';

// ── #35 hexenc — stringifies ANY value (like uc/lc): warn + "Coerce to string" fix ──
hexenc("" + 123);        // warn: integer coerced to string.  QF -> hexenc("" + 123)
hexenc("" + [1, 2]);     // warn: array coerced
hexenc("cafe");     // clean — already a string
// b64enc is NOT total — it returns null for a non-string — so it STAYS a hard error:
print(b64enc("123"), '\n');        // ERROR: b64enc expects string (no coerce fix; b64enc(123) -> null at runtime)

// ── #34 localtime/gmtime — epoch is coerced to int (ucv_to_integer) ──
print(localtime(1700000000), '\n');   // clean — integer epoch
print(localtime("1700000000"), '\n'); // clean — numeric string coerces fine (was a FALSE ERROR before #34)
localtime();             // clean — no arg = current time
gmtime(getenv("EPOCH") || "0");  // clean — runtime string, can't prove non-numeric

// ...but a value that silently coerces to 0 (= 1970-01-01) is a footgun -> warn:
print(localtime("not-a-number"), '\n');   // warn: non-numeric string -> 0 = 1970
print(localtime([1]), '\n');              // warn: array -> 0 = 1970
print(gmtime("abc"));               // warn (gmtime mirrors localtime)
