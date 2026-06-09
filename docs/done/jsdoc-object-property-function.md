# `@param` JSDoc on an object-literal property function is ignored

Status: **DONE (0.6.190)** — parseObject now captures property-leading JSDoc (anchored at
the key) onto the Property node and propagates it to a function/arrow value; tests
test-jsdoc-object-property-function.test.js (13). Date: 2026-06-08.
Repro from firewall4 `mocklib.uc`.

## Symptom

```js
global.mocklib = {
    /**
     * @param {string} module
     */
    require: function(module) {
        return require(module);   // module : unknown
        //     "Argument 1 of require() is unknown. Use a type guard to narrow to string."
    },
};
```

The `@param {string} module` annotation is ignored — `module` stays `unknown`. **And the
"Add JSDoc" quick fix doesn't help either**: it inserts the same block before the property and
the diagnostic persists.

## Root cause — the property JSDoc is orphaned (captured by nobody)

JSDoc is attached to a node only by `findLeadingJsDoc(pos)` (parserUtils.ts), which requires
**only whitespace** between the comment's `*/` and `pos`:

```ts
const between = this.sourceText.substring(c.end, nodeStartPos);
if (between.trim().length > 0) break;   // any non-whitespace ⇒ reject
```

Two would-be capture sites both miss it:

1. **The function expression** anchors at the `function` keyword:
   `parseFunctionExpression` → `findLeadingJsDoc(start /* = 'function' pos */)`
   (primaryExpressions.ts:280). Between the JSDoc and `function` sits **`require:`** →
   non-whitespace → rejected.

2. **The Property node never even looks.** `parseObject` (compositeExpressions.ts:53-164)
   builds `{ type:'Property', key, value, … }` and **never calls `findLeadingJsDoc`** — there
   is no JSDoc capture in object-property parsing at all.

So the comment attaches to nothing; `applyJsDocToParams` (called from
visitFunctionExpression:1579 / visitArrowFunctionExpression:1639, reading the function node's
own `leadingJsDoc`) has nothing to apply. This also explains the failed quick fix: it inserts
the block before the property key, but parsing never captures a property-leading JSDoc, so the
insert is orphaned exactly like a hand-written one.

(Contrast: `let f = function(){…}` works because `visitVariableDeclaration` propagates the
declaration's `leadingJsDoc` onto the init — semanticAnalyzer.ts:410-416. Object properties
have no equivalent propagation, and unlike the declaration case the JSDoc isn't even captured
upstream.)

## Fix design

Capture the property's leading JSDoc in `parseObject`, anchored at the **key** position (where
it's adjacent), and propagate it to a function/arrow value:

```ts
// in parseObject, once the key token position is known (e.g. token.pos at line 85):
const propJsDoc = this.findLeadingJsDoc(keyStartPos);   // only-whitespace check passes before the key
…
const value = this.parseExpression();
if (propJsDoc) {
    propertyNode.leadingJsDoc = propJsDoc;              // for hover / go-to
    if ((value.type === 'FunctionExpression' || value.type === 'ArrowFunctionExpression')
        && !value.leadingJsDoc) {
        value.leadingJsDoc = propJsDoc;                // so applyJsDocToParams picks it up
    }
}
```

This mirrors the `VariableDeclaration` propagation (410-416) but for object properties, and
fixes both branches at once: the function-value's params now receive the JSDoc, and the
Property node carries it for hover. Capture must use the key start (not the function start) so
the only-whitespace adjacency check holds.

### Payoff

`module : string` → `require(module)` type-checks; UC7003 is satisfied by the annotation; and
the "Add JSDoc" quick fix becomes effective (its existing before-the-property insert position
is correct once the parser captures property-leading JSDoc). Applies to every
`{ key: function(...){...} }` / `{ key: (...) => … }` — a very common ucode pattern (mocklib,
fw4 proto handlers, the uvol `uci.uc` `uvol_uci` object, etc.).

### Note

Verify the `findLeadingJsDoc` anchor for **shorthand** properties and the first property after
`{` (no regression on plain data properties — a non-function value just carries the JSDoc on
the Property node, harmless). Keep the existing exclusion of inline **callback-argument**
functions (a function passed as a call argument is not a property value) — see
`docs`-referenced JSDoc-quickfix-attachability note.
