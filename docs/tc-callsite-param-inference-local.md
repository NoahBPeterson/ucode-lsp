# Call-site argument-union typing for non-escaping file-local functions

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit (31,445 findings; the
`param-decl` + `read-of-param` bucket ≈ 16.8k occurrences — 5,566 param declarations + 11,046 reads
that trace to a param + ~350 typed-union variants; **53% of all findings**, the single biggest
bucket). This ticket covers the *file-local, non-escaping* sub-population.

## The gap

An unannotated function parameter is declared `UNKNOWN` (semanticAnalyzer.ts:3759,
`applyJsDocToParams` — "No JSDoc — declare all params as UNKNOWN"). Every read of that parameter then
inherits `unknown` from the symbol table, so hover shows `unknown` on both the declaration and every
use. The 2:1 read-to-decl ratio means **fixing the declaration's type fixes the reads for free** —
reads are pure symbol-table lookups, not an independent problem.

The design rule forbids inferring a param's type from *how the body uses it*. But the arguments passed
at the **call sites** are a separate, sound signal that is currently ignored. For a large class of
OpenWrt helpers, every call site passes a concretely-typed argument:

```ucode
// adblock-fast/files/lib/adblock-fast/adblock-fast.uc
function cmd_output(c) {           // c: unknown   (line 227)
    let p = popen(c, 'r');         // c: unknown   (line 228)
    ...
}
// every call site passes a concrete string:
cmd_output('dnsmasq --version');                    // line 327  → string literal
// cmd_rc(c) likewise:  cmd_rc('/usr/sbin/ipset help hash:net')   line 324

// mwan4/files/lib/mwan4/cli.uc
function command_help(cmd, help) { // cmd, help: unknown   (line 11)
    printf("%-25s%s\n", cmd, help);
}
command_help('start', 'Load nft rules, ip rules and ip routes');  // both string literals
command_help('stop',  'Unload nft rules, ip rules and ip routes');
// ... 20+ call sites, all (string, string)

function println(s) { print(s + '\n'); }             // s: unknown, all calls pass strings
```

In all three the parameter is provably `string` — but the tool reports `unknown` on the decl and
every read (adblock alone: `cmd_output`/`cmd_rc`/`shell_quote`/`ram_uci` account for dozens of
findings; `command_help`/`println` similar in mwan4).

## Root cause

- Params get `UNKNOWN` unconditionally when no `@param` JSDoc is present
  (`src/analysis/semanticAnalyzer.ts:3756` `applyJsDocToParams`, the `if (!jsDocNode)` branch).
- Nothing ever revisits a param's type from its call sites. The infrastructure to *read* call
  arguments exists (the type checker already evaluates argument node types for arity/nullability
  checks in `src/analysis/checkers/builtinValidation.ts` and the UC2004 return-type path), but there
  is no pass that *collects arguments per callee and writes back the union onto the param symbol*.
- The related `docs/parameter-forwarding-return-types.md` is **orthogonal**: it forwards a param's
  type *to the return* (`return x`); it does not type the param itself. This ticket is the input
  side.

## Proposed approach

A post-declaration, whole-file pass (after all symbols and their types are known):

1. **Enumerate candidate functions.** A named `function foo(...) {}` declared at file/block scope with
   no `@param` JSDoc on any param and no rest/variadic param (can't index a spread by position — same
   carve-out as the forwarding doc).
2. **Escape analysis (the soundness gate).** Walk the file; classify every reference to `foo`'s name.
   The function is a candidate **only if every reference is in call position** (`foo(...)`). Bail if
   the name is *ever* used as a value: passed as an argument, assigned (`x = foo`, reassignment of
   `foo`), stored in an object/array literal, returned, an operand of `&&`/`||`/ternary/`type()`,
   exported (named or via a `default { foo }` object), or assigned to `global.foo`. Any of these
   means a hidden call site with unknown args exists → not enumerable → bail. Use the centralized
   scope machinery (`src/ast/scopeRoles.ts`, `collectScopeBindings`) so shadowing is handled and the
   pass can't drift.
3. **Collect per-position argument types.** For each in-file `foo(a0, a1, …)`, evaluate each
   argument's type via the existing `typeChecker.getTypeOf(node)`. For param position N, union the
   types of argument N across all call sites (missing arg ⇒ contributes `null`, matching ucode's
   "unpassed param is null" semantics — verify against `ucode/lib`/`vm.c` before relying on it).
4. **Write back — but only when the union is a genuine improvement.** If *any* call site's argument N
   is itself `unknown` (e.g. it's another unknown param, transitive helper chains), the union contains
   `unknown` → collapses to `unknown` → leave the param `UNKNOWN` (no regression, no false precision).
   Only stamp the param when **every** visible argument at that position is concretely typed. Stamp by
   re-declaring the param symbol with the computed `UcodeDataType` instead of `UNKNOWN`.

Everything is O(call sites) with no body re-analysis — this is *not* the rejected monomorphization.

## Soundness risks

- **Escape = hidden call site.** The entire safety of the mechanism rests on step 2. If a function
  can be reached via a value reference, in-file call args are not the full population and the union is
  unsound. The gate must be conservative: *any* non-call reference bails. (ucode names are mutable
  bindings — `function foo(){}; foo = bar;` is legal — so reassignment must bail too.)
- **Recursion / transitive chains.** Self-calls and helper-calls-helper commonly pass an unknown
  param through; step 4's "any-unknown ⇒ stay unknown" rule makes these safe but unimproved. This is
  why the *win* is confined to leaf helpers fed concrete literals (the `cmd_output`/`command_help`
  shape), not `mac_parse(mac)` where the caller's `mac` is itself an unknown param.
- **Block-scoped / nested functions** (e.g. `parse_args`'s inner `isspace(c)` in
  `luci/.../commands.uc`) are fine — the escape scan is scoped to the function's binding scope — but
  the enumeration must respect the *binding* scope, not the whole file, or a same-named outer function
  would poison it. `scopeRoles.ts` already draws these boundaries.
- **Argument nullability drift.** Widening a missing/`||`-defaulted argument must match runtime
  semantics exactly (unpassed ⇒ null). Getting this wrong would introduce the very null-related FPs
  the param-body rule was removed to avoid. Grounded verification against the interpreter is required.

## Classification

**Partially solvable.** Covers sub-populations **(a) file-local, single/consistent concrete arg
type** in full, and **(b) file-local, mixed concrete arg types** (yields a real union, e.g.
`string | integer`) — provided the function never escapes and no call site passes an unknown
argument at that position. Does **not** cover exported/cross-file callees (see
`tc-callsite-param-inference-crossfile.md`), framework callbacks, or transitive helper chains whose
leaves are themselves unknown params. Realistic reach of *this* ticket: roughly the leaf-helper slice
of the bucket — order-of a quarter of the 16.8k — but it is the highest-confidence, lowest-blast-
radius slice and it fixes both the decl and its reads together.
