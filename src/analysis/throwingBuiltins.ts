// Builtins that throw on bad input/environment where a defensive try/catch is the right guard
// (UC8001). Each entry describes per-builtin behavior so severity/quick-fix specialisation stays
// data-driven instead of scattered `name === 'x'` checks. Verified against the interpreter:
//   json        — parse error / non-string|object argument
//   loadfile    — file open error / compile error
//   loadstring  — compile error
//   require     — module not found
//   render      — missing/broken template, or an exception thrown by the rendered function
// Deliberately NOT here: `system` (arg-type throws → handled by UC2004), `proto`/`trace`
// (niche arg-type throws), `call` (only propagates the callee's exception), and
// `die`/`assert`/`exit` (intentional control-flow throws).

export interface ThrowingBuiltinSpec {
  /** Stay a Warning even under `'use strict'` instead of escalating to an Error. */
  warnOnly?: boolean;
  /** How the "Wrap in try/catch" quick fix should populate the catch block:
   *  'modules' → enumerate the modules on the require search path at runtime (fs.glob loop). */
  catchStyle?: 'modules';
  /** Don't flag the call when its string-literal argument provably resolves. Strategy:
   *   'module' → a builtin (available at the target version) or a file on the require search path
   *   'path'   → a file path (relative/absolute) that exists on disk
   *  When it does NOT resolve, the diagnostic uses a specific "not found" message. Overridden by
   *  the `warnResolvableThrowingCalls` setting (which warns even when it resolves). */
  resolvable?: 'module' | 'path';
  /** The call's first argument may be a FUNCTION (e.g. `render(fn, …)`); when it is, the call
   *  only PROPAGATES the callee's exceptions (like `call()`), so don't flag it. */
  functionArgSafe?: boolean;
}

export const THROWING_BUILTINS: ReadonlyMap<string, ThrowingBuiltinSpec> = new Map<string, ThrowingBuiltinSpec>([
  // json is the ONLY one that escalates to an Error under 'use strict' by default (the
  // `strictThrowingCalls` setting escalates the rest); its argument is opaque data.
  ['json', {}],
  // loadstring's argument is source CODE (nothing to resolve) — plain throws, warning-only.
  ['loadstring', { warnOnly: true }],
  // A missing module is a common fail-early expectation → warning-only; enumerate available
  // modules in the generated catch; and don't warn when the module provably resolves.
  ['require', { warnOnly: true, catchStyle: 'modules', resolvable: 'module' }],
  // loadfile takes a PATH → warning-only, silent when the file exists.
  ['loadfile', { warnOnly: true, resolvable: 'path' }],
  // render is polymorphic: a STRING first arg is a template path (like loadfile → resolvable),
  // a FUNCTION first arg just runs+captures it (like call → only propagates). Warning-only.
  ['render', { warnOnly: true, resolvable: 'path', functionArgSafe: true }],
]);

export function isThrowingBuiltin(name: string): boolean {
  return THROWING_BUILTINS.has(name);
}
