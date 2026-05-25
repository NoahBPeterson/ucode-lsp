# Changelog

## 0.6.32 – 0.6.58 (2026-05-21 → 2026-05-25)

A large batch of type-inference accuracy fixes, new IDE features (member
completion, JSDoc quick-fix, rich exception hover), and a major test/coverage
hardening pass. Highlights below, grouped by area; exact version tags in
parentheses.

### New features

- **Member completion for object values** — typing `obj.` now lists the object's
  own properties for object literals, `catch` parameters, and function-local
  objects (0.6.54); named-imported object values, e.g. `import { CONF }; CONF.`
  (0.6.55); objects returned by an imported *named* factory, e.g.
  `import { make }; let o = make(); o.` (0.6.56); and direct factory call chains
  `make().` with no intermediate variable (0.6.57).
- **JSDoc inference quick-fix** (0.6.32) — offers to add a `/** @param */` block
  with parameter types **inferred from body usage** (e.g. `substr(x)` → `string`,
  `push(x)` → `array`), instead of `{unknown}` stubs.
- **Rich hover for exception properties** (0.6.58) — hovering `e.stacktrace` /
  `e.message` on a `catch` parameter now shows the detailed doc, including the
  stacktrace frame structure (`filename`, `line`, `byte`, optional
  `function`/`context`).
- **NaN-producing arithmetic lint** (0.6.48, UC2008) — flags arithmetic that
  provably evaluates to NaN (an `array`/`object`/`function`/`regex` operand, e.g.
  `arr - 1`, `-[1]`, `obj * 2`); escalates from a warning to an **error** under
  `'use strict';` (0.6.49).

### Type-inference fixes

- Division/modulo by `null` now infers `double`, not `integer` (0.6.40).
- Arithmetic over union types distributes across members instead of collapsing
  to a single type (0.6.41); real unions from function return values now
  propagate into arithmetic and logical expressions (0.6.43).
- Logical `||` / `&&` recognize `array<T>`, `object`, and module operands as
  truthy (0.6.42).
- Consolidated all arithmetic onto a single implementation and fixed an
  exponentiation (`**`) inference gap (0.6.44).
- Fixed `||` type-guard narrowing for refined union members — a regression where
  narrowing dropped already-refined members (0.6.45), plus defensive hardening of
  the remaining union comparison sites (0.6.46).
- Corrected unary-operator type inference (0.6.48).
- String-literal arithmetic operands are now classified as `int` vs `double`
  based on their contents (0.6.51).

### Hover

- Resolves namespace-import members (`import * as U`; hover `U.foo`) (0.6.34).
- Resolves object-property and imported-name hovers via the AST, replacing the
  old regex source-scraping (0.6.35) — more accurate and robust to comments,
  strings, and renames.
- Fixed broken hover on regex literals (0.6.50).

### Go to definition

- Follows re-export chains (`export { x } from './a'`) and resolves
  namespace-import members (0.6.33).
- No longer returns a bogus `builtin://…` location for builtin-module imports
  such as `import { open } from 'fs'` — these correctly report "no definition"
  (0.6.52).
- Resolves imported *variables* (not just functions) to their precise declaration
  line (0.6.53).

### Completion

- Lists a user module's exports via the AST, fixing renamed imports and exports
  hidden by comments or strings (0.6.36); reads exports from the cached AST with
  correct path resolution and freshness (0.6.37).

### Cross-file resolution

- Content-based file cache fixes stale results from mtime collisions (0.6.38).
- Import resolution now reads the live (unsaved) editor buffer instead of stale
  on-disk content (0.6.39).

### Internal / refactoring

- Removed the dead CFG dataflow/type-state pipeline and a scope-blind CFG
  type-query fallback; flow-sensitive typing lives solely in the type checker.
  The CFG is now used only for unreachable-code detection.
- Removed ~28 dead exported helpers and superseded object-type registries
  (verified zero references); pruned dead `regexTypes`/`typeCompatibility` code.

### Tooling

- Added `coverage:e2e` — end-to-end V8 coverage of the spawned LSP server,
  remapped to `src/` (later updated to run **both** test systems, not just the
  curated runner) (0.6.47).

### Tests

- Extensive end-to-end test additions driving the real server over stdio:
  go-to-definition (all import-resolution styles + reachable edge branches),
  hover (namespace/object/exception), completion contexts and cross-file member
  completion, lexer/parser edge cases, and the file resolver.
- A correctness-focused **quick-fix edge-case suite** that applies each fix's
  edits and re-analyzes to confirm the patched code is well-formed and the
  diagnostic is actually resolved — across one-liner functions, braceless bodies
  (with/without `else`), loops, conditions, nested-call and member-path guards,
  union tightening, `||` fallbacks, scoping safety, and CRLF.
- Raw-protocol server lifecycle/workspace coverage (initialize variants,
  workspace-folder and watched-file change handlers).
