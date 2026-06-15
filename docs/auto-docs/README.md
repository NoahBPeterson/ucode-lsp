# Auto-discovered ucode-lsp weaknesses

180 undocumented, user-facing weaknesses found by exercising every surface of the ucode-lsp — diagnostics, completion, hover, signature-help, inlay hints, code lens, code actions, references, definition, document symbols/highlight, folding, the lexer/parser, the builtin & module models, JSDoc/type-annotation handling, import/module resolution, format-string & regex validation, operator/expression typing, control-flow analysis, position/encoding robustness, diagnostic-code/message consistency, and the validation pipeline — across every git subrepo in the workspace (firewall4, luci, mwan4, pbr, openwrt, packages, ucode, utest, unetacl). Each was verified against `/usr/local/bin/ucode` and/or the ucode C source (`ucode/lib/*.c`, `ucode/lib.c`, `ucode/vm.c`). None overlap the existing `docs/*.md` analyses.

Method: corpus `.uc` files scanned via the LSP test harness, the by-design noise filtered out, then fan-out audits (builtin signatures, module member/constant sets vs the C source, JSDoc, import resolution, the format mini-language, regex, operators, the CFG, Unicode/CRLF position handling, code actions, completion contexts, diagnostic codes, and hover content). Every pattern was reduced to a minimal repro and checked against the real interpreter (or the authoritative C source) to separate true positives from bugs.

Findings **01–15** are diagnostic/parser/type false-positives and the lexer crash. **16–30** cover the validation pipeline, completion & hover, and lexer edge cases. **31–60** cover builtin/module modeling, feature providers, format/regex validation, and control-flow. **61–90** cover JSDoc/type-annotation handling, import/module resolution, operator typing, lexer position/encoding accuracy, and the signature-help/inlay/highlight providers. **91–120** cover code-action correctness, completion quality/contexts, diagnostic-code & message consistency, hover content, and miscellaneous semantics (including a second server-crash vector). **121–180** cover deep per-builtin and per-module return-type modeling (string/array/fs/uci/math/struct/zlib/uloop/socket builtins & objects), the operator-coercion and type-narrowing matrices, parser precedence edges, the @typedef/@callback/@enum subsystem, and cross-file/default-export type propagation.

| # | Finding | Kind | Severity |
|---|---|---|---|
| [01](../done/01-lexer-double-brace-mode-flip-crash.md) | ✅ **FIXED 0.6.196** — `}}`/`{{`/`%}` in code flips lexer to template mode → **server crash** + silent diagnostic drop (triggered by ordinary nested object literals) | crash / false-pos | **critical** |
| [02](../done/02-import-name-collides-with-builtin.md) | ✅ **FIXED 0.6.197–198** — Importing/defining a builtin-named symbol (`assert`, …21 names) → false UC3001/UC1007 + cascading member errors (breaks `utest`) | false-pos | high |
| [03](../done/03-socket-namespace-typed-as-object.md) | ✅ **FIXED 0.6.200** — `import * as socket` typed as the socket *object* → module funcs/constants false-error; wrong completion; hover disagrees | false-pos | high |
| [04](../done/04-ubus-module-missing-conn-fns.md) | ✅ **FIXED 0.6.201** — `ubus` module missing `call`/`publish`/`listener`/… (registered on module scope per ubus.c) | false-pos | med-high |
| [05](05-cross-function-variable-type-leak.md) | A `fs.proc` local leaks its type into a same-named local in another function | false-pos | medium |
| [06](../done/06-comma-operator-in-conditions.md) | ✅ **FIXED 0.6.203** — Comma operator rejected in `if`/`while`/`switch` conditions → parse cascade + false UC6001 (ucode has no do-while) | false-pos (parse) | medium |
| [07](../done/07-union-object-array-member-access.md) | ✅ **FIXED 0.6.211** — Dot access on `object \| array` union → false "does not exist on array type" (nl80211/rtnl `request()`) | false-pos | medium |
| [08](08-disable-comment-ux.md) | `// ucode-lsp disable` only downgrades severity, no next-line/file/rule form, self-flags when unused | UX | medium |
| [09](../done/09-in-operator-over-map-filter-keys.md) | ✅ **FIXED 0.6.213** — `'x' in map/filter/keys(param)` → false "'in' requires object or array" (ucode's `in` is null-safe over anything) | false-pos | medium |
| [10](../done/10-render-builtin-variadic-arity.md) | ✅ **FIXED 0.6.214** — `render()` modeled as max-2-args; ucode's `render(fn, ...args)` is variadic | false-pos | low-med |
| [11](../done/11-default-keyword-in-brace-specifiers.md) | ✅ **FIXED 0.6.230** — `import { default as X }` / `export { x as default }` rejected (valid ucode on all versions, oracle-verified) | false-pos (parse) | medium |
| [12](12-uc1008-builtin-shadow-noise.md) | UC1008 warns on shadowing builtins for everyday names (`type`/`index`/`length`/…) | noise | low |
| [13](13-nullable-argument-message-clarity.md) | nullable-argument message says "expects string or object" when the cause is nullability | message clarity | low |
| [14](14-nullish-assign-member-typed-as-array.md) | `(obj.k ||= {})[key]=v` mis-infers `obj.k` as array → `keys()` false-errors | false-pos | low |
| [15](../done/15-delete-array-index-false-negative.md) | ✅ **FIXED 0.6.220** — `delete arr[i]` on an array element now emits UC2002 (was a silent false negative) | false-neg | low |

## Findings 16–30 (validation pipeline, completion/hover, lexer)

| # | Finding | Kind | Severity |
|---|---|---|---|
| [16](../done/16-const-reassignment-never-flagged.md) | ✅ **FIXED 0.6.202** — Reassigning a `const` is never flagged — the validator is dead code (hybrid-validator import commented out) | false-neg | high |
| [17](../done/17-use-before-declaration-contradictory.md) | ✅ **FIXED 0.6.231** — use-before-declaration of a `let`/`const` now emits a single accurate **UC1011 "used before its declaration"** (was contradictory UC1001+UC1006); scope-discriminated so out-of-scope/loop-escape reads stay UC1001 | false-pos | medium |
| [18](18-call-non-function-misleading-message.md) | Calling a defined non-function variable reports "Undefined function: X" (X is defined, just not callable) | message | low |
| [19](../done/19-nested-object-member-completion.md) | ✅ **FIXED 0.6.237** — nested-object member completion at any depth (`o.inner.`, `o.a.b.`) + aliases (`let i = o.inner; i.`), by descending the object-literal AST | completion | medium |
| [20](../done/20-optional-chaining-completion.md) | ✅ **FIXED 0.6.237** — `obj?.` is now a member-access trigger (TK_QDOT treated like TK_DOT), offering the receiver's members | completion | medium |
| [21](../done/21-completion-inside-strings-comments.md) | ✅ **FIXED 0.6.244** — completion is suppressed inside string literals and comments (a `.` in prose/path/URL no longer pops the builtin list); import-path & JSDoc contexts still complete | completion | low-med |
| [22](../done/22-this-member-completion.md) | ✅ **FIXED 0.6.244** — `this.` inside an object method now completes the enclosing object's properties (wired to the `this` symbol's propertyTypes the analyzer already tracks) | completion | low-med |
| [23](../done/23-nl80211-rtnl-const-namespace-completion.md) | ✅ **FIXED 0.6.237** — `nl80211.const.` / `rtnl.const.` now list the module's constants (the chain `['const']` on the module namespace) | completion | medium |
| [24](../done/24-nl80211-rtnl-constants-as-import-names.md) | ✅ **FIXED 0.6.240** — nl80211/rtnl constants are no longer offered as `import { }` names nor accepted (they live under the `const` object, not the module scope — C-source verified; socket/io/etc. keep their genuinely top-level constants). Importing one now flags UC3005. | false-neg | medium |
| [25](25-hex-float-literals-rejected.md) | Hex float literals (`0xFF.5`) rejected — valid ucode | false-pos | low |
| [26](26-bare-hex-prefix-no-digits.md) | Bare `0x` with no digits accepted — real ucode error missed | false-neg | low |
| [27](27-invalid-escape-sequences-not-validated.md) | Invalid string/template escapes (`\u41`, `\u{41}`, `\x4`, `\777`) silently accepted | false-neg | low-med |
| [28](28-invalid-digit-number-misleading-error.md) | Invalid-digit literals (`0o9`, `0xG`) produce a misleading cascade error | message | low |
| [29](../done/29-spread-not-counted-as-use.md) | ✅ **FIXED 0.6.230** — Spreading a variable (`...a`) is not counted as a use → false UC1006 (root cause: missing `SpreadElement` dispatch in visitor.ts) | false-pos | medium |
| [30](30-uc-lc-coercible-argument-error.md) | `uc()`/`lc()` flag a coercible non-string argument as an **error**, but ucode coerces it | false-pos | low-med |

## Findings 31–60 (builtins, modules, feature providers, format/regex, control-flow)

| # | Finding | Kind | Severity |
|---|---|---|---|
| [31](31-splice-min-arity.md) | `splice(array)` 1-arg falsely flagged — wrong min arity (real min is 1) | false-pos | low |
| [32](32-match-subject-coerced.md) | `match(non-string, regex)` rejected — the subject is coerced | false-pos | low-med |
| [33](33-exists-non-object-arg.md) | `exists(non-object, k)` rejected — it returns `false`, never errors | false-pos | low |
| [34](34-localtime-gmtime-string-epoch.md) | `localtime`/`gmtime` reject a string epoch — the arg is coerced to int | false-pos | low |
| [35](35-hexenc-coerces-argument.md) | `hexenc(non-string)` rejected — `hexenc` stringifies any input (≠ `b64enc`) | false-pos | low |
| [36](36-graceful-null-builtins-error-severity.md) | `uniq`/`iptoarr`/`arrtoip`/`b64dec` flag type mismatch as **error**; they return null gracefully | false-pos | low-med |
| [37](37-stale-hover-return-docs.md) | Stale hover docs show wrong returns for `min`/`max`/`clock`/`sourcepath`/`gc` | hover content | low |
| [38](38-fs-ioc-dir-constants-missing.md) | fs module missing the four `IOC_DIR_*` constants → false UC3005 | false-pos | low |
| [39](39-nl80211-listener-request-method.md) | `nl80211.listener` object missing its `request()` method | false-pos | low |
| [40](40-nl80211-constants-out-of-sync.md) | nl80211 constant set out of sync — 23 real constants missing → false UC3005 | false-pos | low |
| [41](41-rtnl-constants-out-of-sync.md) | rtnl constant set badly out of sync — 154 real missing **+** 81 phantom accepted | false-pos/neg | low-med |
| [42](42-references-plain-object-method.md) | Find-references / highlight on a plain object method misses all call sites | feature | medium |
| [43](43-function-hover-omits-parameters.md) | Hover on a user function omits the parameter list | hover content | low-med |
| [44](44-function-return-type-not-inferred-for-hover.md) | User-function hover always `Returns: unknown` — return type never inferred | hover/inference | low-med |
| [45](45-type-guard-quickfix-indentation.md) | Type-guard quick-fix uses a hardcoded tab, mismatching surrounding indent | code-action | low |
| [46](46-definition-zero-width-range.md) | Go-to-definition returns a zero-width range for locals (highlights nothing) | feature | low |
| [47](47-document-symbols-gaps.md) | Document symbols omit params and factory-returned object methods | feature | low |
| [48](48-folding-misses-case-clauses.md) | Folding ranges miss individual `case`/`default` clause bodies | feature | low |
| [49](49-printf-positional-args.md) | printf positional args (`%N$`) unrecognized → false UC2006 | false-pos | medium |
| [50](50-printf-star-width-invented.md) | printf `%*d` dynamic width invented (not a ucode feature) → false UC2006 | false-pos | low-med |
| [51](51-printf-nonexistent-conversions.md) | printf accepts non-existent conversions `%a %A %n %p` as arg-consuming | false-pos/neg | low-med |
| [52](52-printf-length-modifiers-false-negative.md) | printf length modifiers (`%lld`, `%zd`) silently accepted — not valid ucode | false-neg | low |
| [53](53-printf-numeric-string-overstrict.md) | UC2007 flags a numeric-string arg to `%d`, but ucode coerces it | false-pos | low |
| [54](54-regex-body-not-validated.md) | Invalid regex literal bodies (`/foo.*(/`, `/[z-a]/`) never validated | false-neg | low-med |
| [55](55-regex-slash-star-misparsed.md) | `/*/` misparsed as a block-comment start → wrong "Unterminated comment" | lexer | low |
| [56](56-bad-regex-flag-cascade.md) | An unsupported regex flag discards the token → cascading false arg-count error | cascade | low |
| [57](57-while-true-not-never-returns.md) | `while(true)` not treated as non-terminating — code after isn't dead, fn isn't never-returns (`for(;;)` is) | false-neg | low-med |
| [58](../done/58-uc4005-reassigned-iteratee-false-positive.md) | ✅ **FIXED 0.6.230** — UC4005 reports a false "infinite loop" **Error** when the iteratee is reassigned in-loop | false-pos | medium |
| [59](59-uc4005-aliased-iteratee-false-negative.md) | UC4005 misses mutation of the iteratee through an alias | false-neg | low |
| [60](60-loop-update-flagged-unreachable.md) | A `for`-update after an unconditional `break` is flagged "Unreachable code" | UX | low |

## Findings 61–90 (JSDoc, import resolution, operators, lexer position, sig-help/inlay providers)

| # | Finding | Kind | Severity |
|---|---|---|---|
| [61](../done/61-jsdoc-returns-ignored.md) | ✅ **FIXED 0.6.233–234** — `@returns {T}` types the function return, reconciled SOUNDLY: it may FILL an `unknown` body or restate/widen, but NEVER narrow away a real possibility (`string\|null`→`string` is flagged, not silently honoured). An uncovered `return` is flagged per-statement (UC7005), no-return on the tag, each with a quick fix that sets `@returns` to the true inferred type/union. (Also fixed: a trailing `//` comment on the JSDoc line no longer severs attachment.) | inference gap | medium |
| [62](../rejected/62-jsdoc-type-tag-unsupported.md) | ⛔ **DECLINED 0.6.234** — `@type {T}` on a variable is an unverified assertion the checker would then trust; for an opaque variable `unknown` is the safe default (suppresses checks), so `@type` only trades that safety away — a footgun with no floor. Intentionally not implemented. | inference gap | medium |
| [63](63-jsdoc-prefix-nullable.md) | JSDoc prefix-nullable `?T` rejected (only postfix `T?` works) | false-pos | low |
| [64](64-jsdoc-object-shape-param-dropped.md) | Object-shape `@param {{a: string}}` silently dropped — no type, no warning | inference gap | low-med |
| [65](65-jsdoc-missing-braces-double-error.md) | `@param string x` (missing braces) → two misleading diagnostics | message | low |
| [66](66-jsdoc-union-unknown-member-collapse.md) | A union with one unresolvable member collapses the whole type to `unknown` | silent loss | low |
| [67](67-jsdoc-duplicate-param.md) | Duplicate `@param` for the same name silently last-wins, no warning | message | low |
| [68](68-jsdoc-blank-line-attaches.md) | A JSDoc comment separated by a blank line still attaches to the function | convention | low |
| [69](../done/69-export-from-reexport-accepted.md) | ✅ **FIXED 0.6.221** — `export { x } from` / `export *` rejected (UC6001); findExports no longer invents the re-exported names | false-neg | medium |
| [70](../done/70-import-missing-uc-extension.md) | ✅ **FIXED 0.6.221** — relative imports now require the explicit `.uc` (no auto-append) → UC3002 | false-neg | medium |
| [71](../done/71-relative-import-workspace-fallback.md) | ✅ **FIXED 0.6.221** — removed the unsound workspace-root fallback for `./`/`../` imports | false-neg | medium |
| [72](../done/72-absolute-import-path-backwards.md) | ✅ **FIXED 0.6.221** — absolute `/path` imports checked on the real filesystem first (workspace-relative only as fallback) | false-pos/neg | low-med |
| [73](73-parse-failed-dependency-misreported.md) | Importing from a file that fails to parse → misleading "does not export X" | message | low-med |
| [74](74-self-import-not-detected.md) | Self-import not detected as a circular dependency | false-neg | low |
| [75](75-circular-import-not-detected.md) | Circular imports (a↔b) not detected | false-neg | low |
| [76](../done/76-in-operator-scalar-rhs-error.md) | ✅ **FIXED 0.6.230** — `x in <scalar/null>` message corrected (kept Error — it's provably always-false; unknown/`object\|null` already exempt) | message | medium |
| [77](77-bitwise-double-operand-warning.md) | Bitwise op on a `double` operand warns, but `x \| 0` is a valid idiom | false-pos | low |
| [78](78-strict-equality-scalar-mismatch.md) | Strict `===`/`!==` between provably-different scalar types not flagged | false-neg | low |
| [79](79-modulo-by-zero-not-flagged.md) | `n % 0` always yields NaN but is not flagged | false-neg | low |
| [80](80-unexpected-char-range-off-by-one.md) | "Unexpected character" diagnostics have an off-by-one, zero-width range | range accuracy | low-med |
| [81](81-surrogate-pair-char-message.md) | Surrogate-pair (emoji) chars → broken `�` message + split range | message/range | low |
| [82](82-non-ascii-identifier-spurious-error.md) | A non-ASCII identifier emits a spurious extra "Expected ';'" | cascade | low |
| [83](83-signature-help-local-object-method.md) | Signature help returns nothing for a local object-literal method call | feature | low-med |
| [84](84-signature-help-this-method.md) | Signature help returns nothing for `this.method(...)` | feature | low |
| [85](85-signature-help-unclosed-call-eof.md) | Signature help disappears for an unclosed call at EOF with a trailing comma | feature | low |
| [86](86-inlay-hints-local-object-method.md) | Inlay hints: no param hints for local object-literal / `this` method calls | feature | low |
| [87](87-document-highlight-no-read-write-kind.md) | Document highlight marks every occurrence as `Text` — no read/write kind | feature | low |
| [88](88-printf-sprintf-zero-args.md) | `printf()` / `sprintf()` with zero arguments falsely flagged | false-pos | low |
| [89](89-in-object-non-string-key.md) | `<non-string> in object` is always false (keys are strings) but not flagged | false-neg | low |
| [90](90-unused-import-generic-message.md) | Unused import → generic "variable never used", no remove-import quick fix | message/feature | low |

## Findings 91–120 (code actions, completion, diagnostic consistency, hover, semantics)

| # | Finding | Kind | Severity |
|---|---|---|---|
| [91](../done/91-type-guard-quickfix-outside-function.md) | ✅ **FIXED 0.6.215** — "Add type guard" inserted the guard OUTSIDE the function for expression-body arrow / fn-expr / object-method / callback params → invalid ucode; now placed inside the function body (block insert or expr-body→block rewrite) | broken fix | high |
| [92](../done/92-uc3006-named-import-fix-leaves-call-broken.md) | ✅ **FIXED 0.6.243** — UC3006 add-import fix for `module.method()`: the namespace import (works as-is) is now preferred, and the named-import variant ALSO rewrites the call (`fs.open(`→`open(`) so neither leaves `module` unbound | broken fix | medium |
| [93](93-add-import-no-merge.md) | Add-import doesn't merge into an existing import from the same module | code-action | low |
| [94](94-add-jsdoc-unreachable-for-arrows.md) | "Add JSDoc" (UC7003) never fires for arrow/fn-expr/object-method definitions | dead coverage | low-med |
| [95](95-add-jsdoc-not-offered-partial.md) | "Add JSDoc" not offered for a function with partial existing JSDoc | missing fix | low |
| [96](../done/96-module-path-completion-broken-with-braces.md) | ✅ **FIXED 0.6.237** — named-import module-path completion (`import { open } from 'f|'`) now offers modules; the backward token scan no longer stops at the specifier `}` | completion | medium |
| [97](97-require-path-completion-missing.md) | `require('…')` path completion not implemented | completion | low |
| [98](98-let-const-name-offers-builtins.md) | `let`/`const`/`for`-init name position offers builtins (rename-on-commit hazard) | completion | low-med |
| [99](99-object-key-position-floods-builtins.md) | Object-literal key position floods with builtins/constants | completion | low |
| [100](100-global-constants-outrank-locals.md) | Ambient globals ranked above user locals in completion ordering | completion | low |
| [101](101-completion-item-kind-wrong-for-constants.md) | `NaN`/`Infinity`/`REQUIRE_SEARCH_PATH` have wrong CompletionItemKind | completion | low |
| [102](102-builtin-completion-detail-no-signature.md) | Builtin completion items carry no signature in `detail` | completion | low |
| [103](../done/103-missing-diagnostic-codes-systemic.md) | ✅ **FIXED 0.6.245** — every diagnostic now carries a stable `code` (typeChecker/builtin/parser sites wired through; minted `UC2010` NOT_CALLABLE) | quality | medium |
| [104](104-dead-registry-codes.md) | Many `UC####` registry codes (and the whole `src/validations/` dir) are dead — *partially addressed 0.6.245*: UC5003/UC5004/UC6003/UC2002 are now live (#103) | dead code | low |
| [105](../done/105-function-redeclaration-unreachable.md) | ✅ **FIXED 0.6.220** — strict-mode function redeclaration now emits UC1007 (was unreachable; non-strict = last wins) | false-neg | medium |
| [106](106-severity-gated-on-strict-mode.md) | UC2008/UC2009 severity flips with `'use strict'` though the bug is strict-independent | inconsistency | low |
| [107](../done/107-argument-validation-inconsistent.md) | ✅ **FIXED 0.6.246** — argument-validation unified: one `, got` wording, proper pluralization, consistent too-many shape, code on every variant | inconsistency | low |
| [108](108-is-unknown-mislabels-nullable.md) | "is unknown" mislabels a value that has a known nullable type | message | low |
| [109](109-cascading-diagnostics-broken-declaration.md) | A broken declaration emits a parse error AND a cascading "unused variable" | cascade | low |
| [110](110-sort-comparator-second-param-unknown.md) | `sort` comparator's 2nd param typed `unknown` (should be element type) | inference | low |
| [111](111-filter-result-element-type-widened.md) | `filter` result element type widened (`array<integer\|double>`) | inference | low |
| [112](112-loadstring-return-doc-wrong.md) | `loadstring` hover documents the wrong return (a function, not the result) | hover | low |
| [113](113-union-with-unknown-not-collapsed.md) | `unknown \| T` union not collapsed to `unknown` (leaks into hover) | hover/type | low |
| [114](114-literal-hover-missing.md) | Hover on a number/string/bool/null literal returns nothing | hover | low |
| [115](115-exponent-literal-typed-integer.md) | Exponent-notation literals (`1e5`) typed `integer` instead of `double` | inference | low-med |
| [116](116-divide-by-zero-typed-integer.md) | Division by zero (`1/0`) typed `integer` though it yields a `double` | inference | low |
| [117](../done/117-deep-expression-nesting-crash.md) | ✅ **FIXED 0.6.235–236** — deep expression nesting no longer crashes the server. A depth guard (MAX_ANALYSIS_DEPTH=1000) bails the recursive walkers before the native stack overflows; the diagnostics path, EVERY feature-provider request handler (folding/links/codeLens/signatureHelp/hover/…), and `findExports` are all contained, so any depth degrades to one honest "too deeply nested" Warning (anchored on the offending statement) instead of a crash or a storm of LSP -32603 errors. Verified to 100k+ terms across paren/array/ternary/unary nesting. | crash | med-high |
| [118](118-deep-parens-spurious-error.md) | Deeply nested parentheses produce a spurious parse error on valid code | false-pos | low |
| [119](119-string-indexing-not-flagged.md) | String indexing `s[0]` not flagged, but it's a runtime error in ucode | false-neg | low-med |
| [120](120-delete-expression-type.md) | A `delete` expression is typed `unknown` instead of `boolean` | inference | low |

## Findings 121–180 (deep builtin/module modeling, coercion & narrowing matrices, parser edges, @typedef, cross-file)

| # | Finding | Kind | Sev |
|---|---|---|---|
| [121](121-push-unshift-novalue-stale-type.md) | `push(arr)`/`unshift(arr)` no-value return leaks stale type, not `null` | inference | low |
| [122](122-sort-object-phantom-null.md) | `sort(object)` modeled `object\|null`; never null | inference | low |
| [123](123-values-drops-element-type.md) | `values()` drops the element type | inference | low |
| [124](124-fs-read-missing-null.md) | fs `read()` returns `string`, missing `\|null` (incl. dir end-of-stream) | inference | low-med |
| [125](125-writefile-signature-wrong.md) | `writefile()` param 2 is a size limit, not a mode; data accepts any | signature | low |
| [126](126-stat-result-shape-lost.md) | `stat()`/`lstat()` result a bare object — known shape lost | inference | low-med |
| [127](127-glob-variadic.md) | `glob()` is variadic; modeled as single param | signature | low |
| [128](128-lsdir-missing-pattern-param.md) | `lsdir()` missing its 2nd `pattern` param | signature | low |
| [129](129-fs-handle-scalar-methods-missing-null.md) | fs handle scalar methods (tell/seek/write/…) drop `\|null` | inference | low |
| [130](130-uci-get-all-result-untyped.md) | `uci.get_all()` result untyped — section shape lost | inference | low-med |
| [131](131-uci-foreach-callback-untyped.md) | `uci.foreach()` callback param untyped (section object) | inference | low-med |
| [132](132-uci-changes-result-untyped.md) | `uci.changes()` result shape untyped | inference | low |
| [133](133-string-literal-nan-not-flagged.md) | Non-numeric string *literal* arithmetic → NaN not flagged | false-neg | low |
| [134](134-bitwise-numeric-string-warning.md) | Bitwise op on a numeric-string operand warns | false-pos | low |
| [135](135-regex-literal-left-equality-not-flagged.md) | `/re/ == 1` (regex on left) always-false not flagged | false-neg | low |
| [136](../done/136-while-loop-no-narrowing.md) | ✅ **FIXED 0.6.219** — `while (cond)` body now narrows the subject (collectGuards WhileStatement case); the canonical `while ((line = fh.read('line')))` idiom is clean | false-pos | medium |
| [137](../done/137-for-loop-no-narrowing.md) | ✅ **FIXED 0.6.219** — `for (;cond;)` body now narrows the subject (collectGuards ForStatement case) | false-pos | low-med |
| [138](138-index-element-narrowing-fails.md) | `if (a[0])` doesn't narrow the element | false-pos | low |
| [139](139-member-hover-unnarrowed-in-guard.md) | Member hover shows un-narrowed type inside a guard | hover | low |
| [140](140-reassign-null-in-guard-widens.md) | Reassign to `null` in a narrowed block widens to `unknown` | over-narrow | low |
| [141](141-json-rejects-file-handle.md) | `json()` rejects an fs.file/proc handle arg | false-pos | low-med |
| [142](142-uc2003-strict-escalation.md) | Excess args escalated to **error** under `'use strict'` (UC2003) | false-pos | low-med |
| [143](143-length-or-default-not-narrowed-strict.md) | `length(x \|\| [])` flagged "may be unknown" under strict | false-pos | low |
| [144](144-numeric-builtin-union-arg.md) | Numeric builtins reject a union arg with all-numeric members (`sleep`) | false-pos | low-med |
| [145](145-fs-proc-property-as-method.md) | Property read on fs.proc reported as "Method does not exist" | message | low |
| [146](146-builtins-reject-zero-args.md) | `min/max/chr/ord/type/uchr` falsely reject zero-arg calls | false-pos | low |
| [147](147-trace-hover-doc-wrong.md) | `trace()` hover doc wrong (integer level; throws on string) | hover | low |
| [148](148-exists-second-arg-coerced.md) | `exists(obj, non-string key)` 2nd arg falsely required string | false-pos | low |
| [149](149-proto-doc-wrong.md) | `proto(o, p)` doc says returns prototype; returns the object | hover | low |
| [150](150-proto-get-form-rejects-string.md) | `proto(string)` get-form falsely flagged | false-pos | low |
| [151](151-ternary-alternate-assignment-rejected.md) | Assignment in a ternary alternate falsely rejected | false-pos | low-med |
| [152](152-for-init-comma-rejected.md) | Comma/sequence in a `for`-init falsely rejected | false-pos | low |
| [153](153-bare-return-before-brace-not-flagged.md) | Bare `return` before `}` not flagged (ucode needs `return;`) | false-neg | low |
| [154](154-typedef-property-typedef-dropped.md) | `@property` typed as another typedef dropped → false UC7004 | false-pos | low-med |
| [155](155-typedef-dotted-property-misparsed.md) | Nested-dotted `@property {…} pos.x` mis-parsed → false error | false-pos | low |
| [156](156-typedef-optional-property-dropped.md) | Optional `@property {…} [count]` dropped | inference | low |
| [157](157-typedef-inline-object-destroyed.md) | Inline-object `@typedef {{x:integer}} Name` destroys the typedef | false-pos | low |
| [158](158-typedef-alternate-order-unrecognized.md) | `@typedef Name {Object}` order not recognized → false UC7001 | false-pos | low |
| [159](159-typedef-alias-loses-type.md) | A typedef alias (union/object) loses its type | inference | low |
| [160](160-jsdoc-callback-enum-template-unsupported.md) | `@callback`/`@enum`/`@template`/function-type unsupported → false UC7001 | false-pos | low |
| [161](161-malformed-typedef-silent.md) | Malformed typedefs fail silently (orphan/dup/no-name `@property`) | missing diag | low |
| [162](162-math-transcendental-double-as-integer.md) | math transcendentals (pow/sqrt/sin/…) return `double` shown as `integer` | inference | low-med |
| [163](163-object-return-mislabeled-module.md) | Object-method returns mislabeled "X module" in hover | hover | low |
| [164](164-zlib-stream-write-missing-null.md) | zlib stream `write()` can return null, modeled `boolean` | inference | low |
| [165](165-uloop-methods-missing-null.md) | uloop object methods drop `\|null` on the error path | inference | low |
| [166](166-socket-pair-io-pipe-element-type.md) | `socket.pair`/`io.pipe` return `array\|null`, element type lost | inference | low |
| [167](../done/167-export-undeclared-name-not-flagged.md) | ✅ **FIXED 0.6.220** — exporting a non-module-local name (undeclared / builtin / imported) now emits UC3003 | false-neg | low-med |
| [168](168-default-import-object-shape-lost.md) | Default-imported object loses its shape | inference | low |
| [169](169-default-import-function-return-lost.md) | Default-imported function loses its return type | inference | low |
| [170](170-transitive-export-type-lost.md) | Transitively re-derived export loses its type | inference | low |
| [171](171-namespace-member-no-signature-help.md) | Namespace-member function calls get no signature help | feature | low |
| [172](172-keyword-completion-wrong-set.md) | Keyword completion offers bogus `throw`, omits real keywords | completion | low-med |
| [173](173-two-level-member-no-hover.md) | Two-level nested member access yields no hover/type | hover | low |
| [174](174-member-completion-ternary-logical-result.md) | Member completion fails on `o \|\| {}` / ternary / `??` results | completion | low-med |
| [175](175-signature-help-object-literal-arg.md) | Signature help fails inside an object-literal arg value | feature | low |
| [176](176-forin-object-array-no-member-completion.md) | `for (let v in array<object>)` var gets no member completion | completion | low |
| [177](177-regex-vs-regexp-type-name.md) | `regex` vs `regexp` type-name inconsistency | naming | low |
| [178](178-replace-callback-params-untyped.md) | `replace(s, regex, fn)` callback params untyped | inference | low |
| [179](179-rindex-base-signature-too-narrow.md) | `rindex` base signature param-1 too narrow (latent) | latent | low |
| [180](180-namespace-const-member-reassign-not-flagged.md) | Reassigning a namespace-imported member not flagged (immutable) | false-neg | low |

The single most important item remains **#01** — triggered by everyday nested object/closure literals (`{a:{b:1}}`, `}});`, `return {x:{y:1}};`), it either crashes the language server or silently stops reporting diagnostics for the rest of the file. **#117** is a *second* crash vector (the analyzer overflowing on deep expression nesting, uncaught). Other high-value items across the set: **#16** (const reassignment — dead validator), **#29** (spread-not-a-use), **#49** (positional printf args), **#58** (UC4005 false "infinite loop" Error), **#61/#62** (`@returns`/`@type` ignored), **#69–#72** (import-resolution mismatches), **#76** (`in`-on-scalar hard error), **#91** (type-guard fix emits broken code), **#105** (function-redeclaration not caught), **#136/#137** (loop-condition narrowing missing — hits the canonical `while ((line = fh.read('line')))` idiom), **#142** (UC2003 strict-escalation on valid code), and **#162** (math transcendentals mistyped).

> Verification note: during the 121–180 round, one agent-proposed finding ("do-while not parsed") was **rejected** after interpreter checking — `do {} while()` is genuinely unsupported by ucode, so the LSP flagging it is correct, not a bug. All 60 retained findings were verified against `/usr/local/bin/ucode` and/or the C source.
