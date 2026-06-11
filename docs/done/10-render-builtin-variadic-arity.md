# `render()` is modeled with a 2-argument cap, but ucode's `render()` is variadic with a function first arg

> **STATUS: FIXED in 0.6.214.** `render()` is now modeled as a static overload on the first
> argument's type (`validateRenderFunction`): `render(path:string, scope?:object)` (include-like,
> max 2, scope = object|null) OR `render(fn:function, ...args)` (variadic). Both return
> `string|null` (the function form returns fn's captured print output — verified, not fn's
> return value). A provably non-string/non-function first arg (`render(5)`) is flagged (matches
> the runtime "Passed filename is not a string" error); an unknown first arg is flagged
> (narrow to string|function). Autocomplete maximized: the builtin doc documents both forms
> (hover + completion), and signature help is now overload-aware — it shows BOTH signatures and
> activates the right one by the first argument's syntactic form (arrow/function-expr → function
> form; string literal → template form). Tests: `tests/test-render-overload.test.js` (21).
> Repro: `render-overload-demo.uc`.

**Severity: low-medium.** The `render()` builtin is modeled as `render(template, [context])` (max 2 args). ucode's `render()` is variadic: when the first argument is a **function**, it calls that function and forwards *all* remaining arguments. Calling `render(fn, a, b, c)` therefore raises a false `Function 'render' expects at most 2 arguments, got N` (plus a spurious `Argument is possibly 'function'`).

## Reproduction

Real corpus: `luci/modules/luci-base/ucode/runtime.uc`:

```ucode
render(call, tmplfunc, null, scope ?? {});   // "expects at most 2 arguments, got 4"
```

Reduced:

```ucode
function g(a, b, c) {}
render(g, 1, 2, 3);     // false "Function 'render' expects at most 2 arguments, got 4"
render('tmpl', {x:1});  // clean (string form)
```

## Verified against the C source

`ucode/lib.c`, `uc_render()` JSDoc and body:

```
* When invoked with a string value as the first argument, the function acts [like include]; the second argument is the scope.
* When invoked with a function value as the first argument, render() calls the given function and passes all subsequent arguments to it.
* @param {string|Function} path_or_func
* @param {Object|*} [scope_or_fnarg1]
* @param {*} [fnarg2]
* @param {...*} x
```

So the signature is two-faced:
* `render(template: string, scope?: object)` — exactly the current model.
* `render(fn: function, ...args)` — variadic, any arity.

## Fix

Model `render` as variadic (or as an overload set) so that a function first argument permits any number of trailing arguments; only enforce the 2-arg shape for the string form. (Other variadic/scope-taking builtins — `call(fn, ctx, scope, ...args)`, `warn`, `print`, `sprintf` — are already modeled correctly; `render` is the lone exception.)
