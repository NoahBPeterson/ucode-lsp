# Methods that are function *references* (not inline literals) carry no return type

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

Return-type inference for `obj.method()` / `this.method()` only works when the property's value is an
**inline** `FunctionExpression`/`ArrowFunctionExpression` in the object literal. Three pervasive corpus
idioms attach methods differently, and all of them lose the return type — the call resolves `unknown`
even though the referenced function's return type is fully inferred on its own symbol:

**1. Identifier-valued property (the "proto table" idiom)** — `openwrt/package/utils/cli/files/usr/share/ucode/cli/context.uc`:

```ucode
function context_select(args, completion) {   // context.uc:211 — return type inferred on its symbol
    let ctx = this;
    ...
    return ctx;
}
const context_proto = {                        // context.uc:683
    select: context_select,                    // ← value is an Identifier, not a function literal
    call: context_call,
    ...
};
// context.uc:476, inside another proto method:
let ctx = this.select(args, true);             // ctx hovers `unknown`
```

**2. Post-hoc property assignment** — `pbr/files/lib/pbr/nft.uc:200`:

```ucode
let nft_file = {};
nft_file.append = function(target, ...extra) { // nft.uc:202
    ...
    return true;                               // boolean — inferred, but never recorded on nft_file
};
// later: nft_file.append(...) → unknown
```

**3. Export-default object built from references** — `mwan4/files/lib/mwan4/mwan4.uc` tail:

```ucode
mwan4.get_iface_mark = get_iface_mark;         // dozens of these
...
export default mwan4;
// mwan4/files/lib/mwan4/mwan4rtmon.uc:7,64:
import m from 'mwan4';
let id = m.get_iface_id(iface);                // unknown
```

Minimal repro (verified via `--type-coverage`): `function helper(x){ return {value:x, ok:true}; }
let obj = { method: helper }; let r = obj.method(5);` → `r` shows `unknown`.

Occurrences: `this.select` ~40, the cli `context.uc`/`callctx.uc` proto-method family ~60,
`nft_file.*`/`editor.*`/`callctx.new` ~25, mwan4 `m.*` importer calls ~20 → **~150 direct**, plus the
propagation each untyped result feeds.

## Root cause

`src/analysis/semanticAnalyzer.ts`:

- `inferObjectLiteralFunctionReturnTypes` (~4308–4325) and `precomputeObjectMethodReturnTypes`
  (~4354–4366) both skip any property whose value is not a Function/Arrow expression:
  `if (val.type !== 'FunctionExpression' && val.type !== 'ArrowFunctionExpression') continue;`
  An `Identifier` value is never resolved through the symbol table, even though the referenced
  `FunctionDeclaration`'s symbol carries `returnType` (symbolTable.ts:387, stamped by the
  return-type inference pass).
- The assignment path (`visitAssignmentExpression`, member-write handling ~5300–5450) records the
  property's *base* type via `inferAssignmentDataType` (FUNCTION) but never records the function's
  return type into the receiver symbol's `propertyReturnTypes` (symbolTable.ts:403) — neither for an
  inline `function(){}` RHS nor for an identifier RHS.
- Cross-file: the default-export shape propagation (fileResolver / the `docs/done/168` object-shape
  work) carries property *types*, and `propertyFunctionReturnTypes` (symbolTable.ts:402) exists as a
  string-hint channel, but nothing resolves a property that is a *reference to a module-local
  function* to that function's inferred return type.
- Consumption side is already in place: `inferMethodReturnType` Case 0 (~6682–6692) reads
  `recvSym.propertyReturnTypes` — only the population is missing.

Related but distinct (do not conflate): `proto(obj, protoObj)` receiver chains (`context.uc:702`
`proto({...}, model.context_proto)`) additionally need prototype-aware member lookup, and `this` inside
a plain `FunctionDeclaration` is unbound — those keep some cli call sites unknown even after this fix.

## Proposed approach

Populate `propertyReturnTypes` for the three shapes, reusing the existing consumption path:

1. **Identifier-valued literal properties**: in `inferObjectLiteralFunctionReturnTypes` (and the
   pre-pass), when `val.type === 'Identifier'`, look the name up in the symbol table; if the symbol is
   a function (`SymbolType.FUNCTION` or dataType FUNCTION) with a concrete `returnType`, record it.
   Also mirror into `propertyTypes` (FUNCTION) and `propertyDefinitionLocations` (the function's decl)
   so hover/go-to-def/signature-help ride along.
2. **Post-hoc assignment**: in the member-write branch of `visitAssignmentExpression`, when the RHS is
   a Function/Arrow expression, record its `_inferredReturnType` (available after the RHS visit; use a
   deferred write like the existing `deferredPropertyWrites`) into the receiver symbol's
   `propertyReturnTypes`; when the RHS is an Identifier resolving to a function symbol, record that
   symbol's `returnType`.
3. **Export-default / cross-file**: in the export-shape analysis in `fileResolver.ts`, resolve
   identifier-valued properties of the exported object to the module's own function symbols and carry
   their return types through the same channel the importer already consumes
   (`propertyReturnTypes` / `propertyFunctionReturnTypes` — see semanticAnalyzer.ts:2253).
4. Guard against staleness: an identifier reference resolves at the point of the literal/assignment;
   if the function is declared *after* the object literal (rare — corpus attaches after declaration),
   fall back to unknown rather than guessing (same define-before-use stance as the sibling-method
   machinery, and the same back-fill hook as `docs/tc-this-method-forward-ref-return.md` could lift it
   later).

Out of scope here (follow-ups): `proto()`-chained receivers and `this` binding inside plain function
declarations invoked as methods — file separately if this ticket's fix surfaces them as the next
blocker on the cli corpus.

## Classification

**Solvable** (items 1–2 are small, mechanical, and sound — they only copy an already-inferred return
type to where the consumer already looks; item 3 is moderate, bounded by the existing cross-file
export machinery). The `proto()`/plain-`this` tail is **partially solvable** and excluded. Estimated
impact: ~150 direct occurrences across openwrt/cli, pbr, mwan4, luci, plus downstream propagation.
