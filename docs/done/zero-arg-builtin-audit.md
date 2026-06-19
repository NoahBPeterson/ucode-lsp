> ✅ **DONE 0.6.254.** Systematic audit of every core builtin for zero-argument behavior, plus `int()` literal-content narrowing.

# Zero-argument builtin audit + `int()` literal narrowing

Audited all ~70 core ucode builtins (the `uc_stdlib_functions` table) for what they return when
called with **zero arguments**, verified against `ucode/lib.c` (4 parallel source readers) and the
`ucode` interpreter. Two classes of fix resulted.

## 1. Valid-but-useless zero-arg calls (~45 builtins)

ucode **accepts** a zero-arg call to these and returns a deterministic dead value (mostly `null`),
but the LSP was raising a hard `UC2003` arity error. That's a false positive (the call runs).
Now, via a single `ZERO_ARG_USELESS_RESULT` table + `applyZeroArgUselessResult` routed through the
two arity chokepoints (`checkArgumentCount` and the typeChecker signature path):

- The call is a **strict-gated `UC2012` "useless call"** — a warning normally, an error under
  `'use strict'` (unified with the existing #88/#146 zero-arg warnings, which now also escalate).
- The return type is **narrowed to the exact zero-arg result**:
  - → `null`: filter, index, rindex, join, keys, length, ltrim, rtrim, trim, map, pop, push, shift,
    unshift, reverse, sort, slice, split, substr, values, match, replace, uniq, iptoarr, arrtoip,
    b64enc, b64dec, hexdec, hexenc, proto, wildcard, timelocal, timegm, call, signal, require, loadfile
  - → `integer` (0): int · → `double` (NaN): hex · → `string`: uc ("NULL"), lc ("null")
  - → `boolean` (false): exists, sleep · → `regex` (/null/): regexp · → `function`: loadstring

**Excluded — these THROW on zero args (genuinely invalid ucode), so they stay hard errors:**
`json`, `include`, `system`, `render`.

## 2. `int()` literal-content narrowing + UC2013

`int(stringLiteral)` is decidable: int() skips leading whitespace + an optional sign, then needs
≥1 valid digit in the base — so `"42"`/`"10abc"`/`"0x1f"`→`integer`, no leading digit
(`"abc"`/`""`)→`double` (NaN). The base is 10 for the 1-arg form, or a literal 2nd arg (2–36):
`int("ff", 16)`→`integer`, `int("zz", 16)`/`int("8", 8)`→`double`. A non-literal string or
non-literal/out-of-range base stays `integer | double`.

New **UC2013** warning flags input that int()'s numeric parse silently drops — underlining exactly
the ignored portion: `int("10abc")`→`abc`, `int("4.9")`→`.9`, `int("0x1f")`→`x1f` (forgot base 16),
or the whole string when nothing parses (`int("abc")`→NaN). Precise offsets only when the literal
is escape-free, else the whole literal; skipped when only trailing whitespace is dropped.

All verified vs the `ucode` interpreter. Tests: `test-zero-arg-builtin-audit.test.js`,
`test-int-string-literal.test.js`, `test-arity-coercion.test.js`.
