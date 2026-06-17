// ============================================================================
// C1 — printf/sprintf validator rewrite (shipped 0.6.249). Spot-check demo.
// All 7 cluster docs (#49,#50,#51,#52,#53,#56,#88).
//
// Each block: the code · what the LSP did BEFORE · what it does NOW · the ground
// truth from the interpreter (run the `ucode -e` line yourself to verify).
// All grammar pulled from ucode/lib.c uc_printf_common (the C source of truth).
//
// >>> The one you flagged — ARITY (#88) — is the LAST block. Veto-friendly. <<<
// ============================================================================


// ── #49  POSITIONAL  %N$  ────────────────────────────────────────────────────
// ucode supports positional conversions; the old parser didn't (the digit landed
// in the width group, the `$` broke the match → "0 specifiers", everything looked
// like an extra arg).
printf("%1$d", 5);              // BEFORE: UC2006 "0 specifiers but 1 argument"   NOW: clean
printf('\n');
printf("%2$s %1$s", "a", "b");  // BEFORE: UC2006 "0 specifiers but 2 args"        NOW: clean
printf('\n');
printf("%2$s", "a");            // NOW: UC2006 "references argument 2 but only 1 provided"  (real too-few)
printf('\n');
printf("%1$s %3$s", "a", "b", "c");  // NOW: UC2006 on "b" — "argument 2 is not referenced (ignored)"  (#49 gap)
printf('\n');
// truth: ucode -R -e 'printf("[%1$d] [%2$s %1$s]", 5, "a")'  ->  [5] [a ...]


// ── #50  STAR WIDTH  %*d  (NOT a ucode feature) ──────────────────────────────
// ucode has no `*` dynamic width. The old parser fabricated an extra INTEGER
// specifier → false "2 specifiers but only 1 argument".
printf("%*d", 42);              // BEFORE: UC2006 "2 specifiers but only 1 arg" (ERROR-ish, WRONG)
printf('\n');
                                // NOW: UC2011 "ucode does not support '*' dynamic width/precision —
                                //              prints literally, consumes no argument"  (targeted)
// truth: ucode -R -e 'printf("[%*d]", 42)'  ->  [%*d]   (the 42 IS dropped)
// STRICTNESS: provably a C-ism, so we name it specifically rather than a generic "extra arg".


// ── #51  BOGUS CONVERSIONS  %a %A %n %p  (not in ucode's set) ─────────────────
// ucode's real conversion set is exactly: d i u o x X  e E f F g G  c  s  J  %.
// `a A n p` are NOT conversions — they print literally and consume no argument.
printf("%a");                   // BEFORE: UC2006 "1 specifier but 0 args"   NOW: UC2011 "'%a' is not a ucode conversion"
printf('\n');
printf("%d %a", 1);             // NOW: UC2011 on %a only (%d still correctly consumes the 1; %a prints literally)
printf('\n');
// truth: ucode -R -e 'printf("[%a] [%d %a]", 1)'  ->  [%a] [1 %a]
// STRICTNESS: was silent in my first pass; now flagged — %a/%A/%n/%p are provably not ucode conversions.


// ── #52  LENGTH MODIFIERS  %lld %hhd %zd  (not in ucode) ─────────────────────
// ucode has no C length modifiers. Old parser silently stripped them → treated
// %lld as a valid %d (false negative — a typo'd format passed review).
printf("%lld", 5);              // BEFORE: no diagnostic (silently OK as %d — false negative)
printf('\n');
                                // NOW: UC2011 "ucode has no length modifiers (l/h/z/j/t) —
                                //              prints literally, consumes no argument"  (targeted)
// truth: ucode -R -e 'printf("[%lld]", 5)'  ->  [%lld]   (literal; the 5 is dropped)


// ── #53  NUMERIC STRING to %d  (ucode coerces) ───────────────────────────────
// ucode coerces a string for numeric conversions: "42"->42, but "hello"->0.
// Old: ALL strings flagged. Now: a numeric string is fine; a statically non-numeric
// string LITERAL is still flagged (it silently becomes 0 — a real footgun).
printf("%d", "42");             // BEFORE: UC2007 flagged   NOW: clean ("42" -> 42)
printf('\n');
printf("%x", "255");            // NOW: clean ("255" -> ff)
printf('\n');
let n = "val_" + "x";           // a non-literal string expression (string type, value not a literal)
printf("%d", n);                // NOW: clean (we only flag non-numeric string LITERALS, not runtime strings)
printf('\n');
printf("%d", "hello");          // NOW: still UC2007 flagged ("hello" -> 0, a footgun)
printf('\n');
let o = {};
printf("%d", o);                // NOW: still UC2007 flagged (object is the likely bug)
printf('\n');
// truth: ucode -R -e 'printf("[%d][%d]", "42", "hello")'  ->  [42][0]


// ── SANITY: things that must still work / still warn ─────────────────────────
printf("%d %s %f", 1, "x", 3.14);  // clean (correct usage)
printf('\n');
printf("%05d %-8s %+d %#x", 7, "a", 7, 255);  // clean (flags/width/precision)
printf('\n');
printf("100%% done");              // clean (%% is literal percent)
printf('\n');
printf("%d %s", 1);                // UC2006 "2 specifiers but only 1 argument"  (genuine too-few)
printf('\n');
printf("%d", 1, 2);                // UC2006 "1 specifier but 2 arguments (extra ignored)"  (genuine extra)
printf('\n');


// ════════════════════════════════════════════════════════════════════════════
// ── #88  ARITY  — resolved per your "stricter for builtins" rule ─────────────
//   BEFORE: printf();  -> ERROR "expects at least 1 argument(s), got 0"  (UNSOUND — ucode runs it)
//   NOW:    printf();  -> UC2012 WARNING "printf() with no arguments has no effect"
//
// The hard error was wrong (ucode accepts zero args, no error). But "allowed/silent" threw away
// a provable fact: a no-arg printf/sprintf is useless. So it's a WARNING, not silence — and this
// is deliberately STRICTER than a user function (we'd never flag a user `f()`, but for printf we
// KNOW it's pointless). Verify: ucode -R -e 'printf(); print("ok\n")' -> ok (empty output).
printf();                       // NOW: UC2012 warning "has no effect (it produces no output)"
let s = sprintf();              // NOW: UC2012 warning "has no effect (it returns an empty string)"
// ════════════════════════════════════════════════════════════════════════════


// ── #56  REGEX-FLAG CASCADE  (lexer fix) ─────────────────────────────────────
// An unsupported regex flag used to make the lexer emit a TK_ERROR and DROP the whole
// regex token — so the enclosing call lost an argument, cascading into a bogus arg-count
// error. Now the lexer emits a valid regex token and reports the flag via a side-channel,
// so ONLY the real flag error shows.
printf("%s", /a/ms);             // BEFORE: "Unsupported flag 'm'" + spurious "1 specifier but 0 args"
printf('\n');                   // NOW:    just "Unsupported regex flag 'm'"  (no cascade)
match("a", /a/m);               // BEFORE: flag error + spurious "match expects at least 2 args, got 1"
                                // NOW:    just the flag error  (regex arg survives → count is right)
let r = /a/gis; print(r);       // valid flags g/i/s → clean
printf('\n');
