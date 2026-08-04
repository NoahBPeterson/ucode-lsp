# ord() takes TWO parameters — and a full lib.c signature re-audit

Status: **ord() fix SHIPPED 0.7.91** (registry two-param + arity cap + literal
in-bounds return refinement + hover/signature docs; tests/diagnostics/
test-ord-two-args.test.js). **The lib.c signature re-audit below is STILL OPEN —
🟠 HIGH PRIORITY** (unknown how many siblings are wrong the same way).

## The reported bug

`ord(str, offset)` is a two-parameter builtin; we register it with ONE
(`typeChecker.ts:383`: `parameters: [UcodeType.STRING]`), so every legitimate
two-arg call gets an arity error. Oracle-verified (BOTH the old /usr/local binary
and master — this is ancient behavior, likely no version gate needed, but the
audit below confirms per pin):

```ucode
print(ord("abc"), "\n");        // 97  (offset defaults to 0)
print(ord("abc", 1), "\n");     // 98
print(ord("abc", -1), "\n");    // 99  (negative = from the END, like substr)
print(ord("abc", 9), "\n");     // null (out of range)
```

lib.c `uc_ord` (vendored checkout 81205a2, lib.c:1284–1312): non-string subject →
null; `nargs > 1` reads arg 1 as int64 (EINVAL → null); negative offset gets
`+= len`; `n < 0 || n >= len` → null; else the byte value.

Fix shape for ord itself:
- `parameters: [STRING, INTEGER]` with the second optional (minParams 1, maxParams 2)
  in the typeChecker registry, plus the builtinValidation twin if it has one.
- Return stays `integer | null` (null on bad subject, bad offset, out of range) —
  the BUILTIN_RETURN_RANGE entry (`typeChecker.ts:177`) is already correct.
- Hover doc (`builtins.ts:13`) gains the offset param + negative-offset semantics.
- Tests: 1-arg, 2-arg, negative offset, 3-arg (arity error), non-integer offset.

## The real ticket: re-audit EVERY lib.c builtin signature, per pinned version

If ord's arity is wrong, others may be. Audit **all functions in lib.c's
`uc_stdlib_functions` table** against our registries, for every pinned OpenWrt
ucode commit:

| Target | ucode pin |
|--------|-----------|
| 22.03  | `46d93c9c` |
| 23.05  | `1a8a0bcf` |
| 24.10  | `3f64c808` |
| 25.12  | `85922056` |
| main   | `b885dd0`  |

Methodology (established tooling):
1. For each pin, `git -C ucode checkout <pin>` (restore to 81205a2 after) and
   extract every `uc_<name>` function's REAL signature from lib.c: how many
   `uc_fn_arg(n)` slots it reads, which are optional (`nargs > k` guards /
   NULL-tolerant paths), value coercions (`ucv_int64_get` + EINVAL, string
   casts), negative-index semantics, and every return-NULL condition.
2. Diff against OUR three registries:
   - `typeChecker.ts` builtin `parameters:`/`minParams`/`maxParams` table (~line 375+)
   - `builtinValidation.ts` per-builtin checkers
   - `builtins.ts` hover docs (params documented + return text)
3. For any function whose signature CHANGED across pins, add per-version gating
   via the existing `flagVersionMin`/`introducedIn` infra (like socket/zlib
   module gating) rather than pinning to the newest.
4. Runtime-verify surprising rows against the reference containers
   (`owrt-2203/2305/2410/2512`; REBUILD owrt-main first — image predates the
   b885dd0 pin bump) — the C source is ground truth for arity, the binary for
   behavior (memory: reference_return_type_audit, local-binary-is-outlier).
5. Deliverables: corrected registries + per-function fail-to-pass tests
   (arity min/max, optional-arg acceptance, return nullability), a table in this
   doc recording per-pin signatures for every audited function, and corpus
   differential runs to vet fallout.

Known-good context to not re-litigate: return TYPES were audited in
reference_return_type_audit (memory) and hardened through 0.7.85–0.7.90
(pop/shift null, split null, match tuple/coercion) — this audit is about
PARAMETER lists (arity, optionality, per-arg types, index semantics), where ord
proves we have at least one hole. printf/sprintf spread handling (0.6.161) and
the JSDoc optional-param machinery (0.7.39) already model optional params — reuse
`minParams`/`maxParams`/optional flags, don't invent a parallel mechanism.
