# `let f = () => {...}` / `let f = function(){...}` — return type never inferred

Status: **DONE (0.6.193)** — arrow/anon-fn visitors infer + stash the return type
(`_inferredReturnType`); the declarator stamps it onto the function-valued symbol;
inferFunctionCallReturnType accepts a FUNCTION-dataType VARIABLE; expr-body arrows use a
new non-emitting `checkNodeQuietly`. Tests test-function-valued-variable-return-type.test.js
(12). Verified with the validator.
Date: 2026-06-08. Repro from firewall4 `mocklib.uc` (`read_data_file`).

## Symptom

```js
let read_data_file = (path) => {
    for (let dir in MOCK_SEARCH_PATH) {
        let fd = _fs.open(dir + '/' + path, "r");
        if (fd) { let data = fd.read("all"); fd.close(); return data; }   // string | null
    }
    return null;                                                          // null
};

let read_json_file = (path) => {
    let data = read_data_file(path);   // data : unknown   ← should be string | null
    if (data != null) {
        return json(data);             // "Function 'json' expects string or object" — because data is unknown
    }
};
```

`read_data_file` returns `string | null`, so `data` should be `string | null` and (after the
`!= null` guard) `json(data)` should type-check. Instead `data` is `unknown`.

## Scope — broader than arrows

Verified with a minimal repro (length() on the result flags "unknown" for both):

| form | return type inferred at call site? |
|---|---|
| `function foo(p) { … }`  (named declaration) | **yes** |
| `let f = function(p) { … }`  (anonymous expression) | **no** |
| `let f = (p) => { … }`  (arrow) | **no** |

So this is **every function value bound to a variable** (arrow *and* anonymous
`function` expression), not arrow-specific. Only top-level named declarations work — and
function-valued `let`/`const` is extremely common in ucode (mocklib, fw4, the uvol scope
helpers, etc.).

## Root cause — two gaps

1. **Return type is never computed for anonymous/arrow bodies.** The named-function path
   (semanticAnalyzer.ts:1474-1482) does:

   ```ts
   const returnTypes = (this.functionReturnTypes.get(node) || []).map(e => e.type);
   const inferredReturnType = this.typeChecker.getCommonReturnType(returnTypes);
   const symbol = this.symbolTable.lookup(name);          // ← needs a NAME
   if (symbol) { symbol.dataType = FUNCTION; symbol.returnType = inferredReturnType; }
   ```

   `visitArrowFunctionExpression` (1618-1682) collects returns into `functionReturnTypes`
   but **never calls `getCommonReturnType` and never stores a `returnType`** — and an arrow
   is anonymous, so there's no symbol to store it on. (The anonymous `function(){}` case
   has the same hole.)

2. **The call-site resolver rejects function-valued variables.** `inferFunctionCallReturnType`
   (semanticAnalyzer.ts) only returns a type when the callee symbol is a
   `FUNCTION`/`IMPORTED` kind:

   ```ts
   if (symbol && (symbol.type === SymbolType.FUNCTION || symbol.type === SymbolType.IMPORTED))
       return symbol.returnType || null;
   return null;
   ```

   `let read_data_file = …` is a **VARIABLE** symbol (its `dataType` is `FUNCTION`, but its
   `SymbolType` is `VARIABLE`), so even if `returnType` were populated, this guard drops it.

## Fix design

Both gaps must be closed:

1. **Infer + propagate the return type for arrow/anonymous-expression bodies.** The arrow
   visitor already learns its bound name via `pendingFunctionExprName` (consumed at line
   1621 for `let f = () => …`). After visiting the body, compute
   `getCommonReturnType(functionReturnTypes.get(node))` and store it on the bound symbol —
   mirroring 1474-1482. (Or stash `node._inferredReturnType` and have the variable declarator
   read it; whichever respects declare/visit ordering.) Do the same in the anonymous
   `function(){}` expression path.

2. **Let the call-site resolver accept a function-valued VARIABLE.** Broaden
   `inferFunctionCallReturnType` (and the TypeChecker's call-return path) to also return
   `symbol.returnType` when `symbol.dataType` is `FUNCTION` and a `returnType` is present —
   not only for `SymbolType.FUNCTION`. Guard on `returnType` being set so non-function
   variables are unaffected.

### Payoff

`data : string | null` → the `!= null` guard narrows it to `string` → `json(data)` type-checks;
`length()`/member/arg checks light up on every `let fn = …` result. Removes a large class of
spurious "unknown argument" diagnostics in function-heavy ucode.

### Note

Parameter inference for these forms already works (the `pendingFunctionExprName` path drives
UC7003 + JSDoc on arrows/expressions); only the **return** side was missing. Reassigned
function variables should follow the existing SSA discipline (the declared signature holds at
the declaration site).
