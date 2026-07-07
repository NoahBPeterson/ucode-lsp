# `include()` scope resolution — findings & design

Status: **investigated, not implemented.** Verified vs `/usr/local/bin/ucode`.
Date: 2026-06-08. Corpus: `packages/utils/uvol/files/{uvol, uci.uc, blockdev_common.uc, lvm.uc}`.

## Symptom

```
uvol:38  ctx.uci_add    = uvol_uci.uvol_uci_add;   // UC1001 Undefined variable: uvol_uci
uvol:39  ctx.uci_remove = uvol_uci.uvol_uci_remove; // UC1001
uvol:40  ctx.uci_commit = uvol_uci.uvol_uci_commit; // UC1001
uvol:41  ctx.uci_init   = uvol_uci.uvol_uci_init;   // UC1001
lvm.uc:52 blockdev_common.get_partition(...)        // UC1001 Undefined variable: blockdev_common (×2)
```

`uvol_uci` is defined in `uci.uc` and pulled in via `include("/usr/lib/uvol/uci.uc")`
(uvol:37). `blockdev_common` is defined in `blockdev_common.uc`, pulled in via
`include("/usr/lib/uvol/blockdev_common.uc")` (lvm.uc:51). Both are real, valid references —
the diagnostics are **false positives**.

## Root cause

`include()` is registered as a builtin (builtins.ts:26, typeChecker.ts:2284) but
`validateIncludeFunction` (checkers/builtinValidation.ts) only checks **arg count + types**:

```ts
validateIncludeFunction(node) {
  // arity 1..2, arg0:string, arg1:object — and nothing else
}
```

It never resolves the path, never parses the target, never merges any symbols. So every
name an `include()` brings into scope is invisible to the analyzer → UC1001.

## Verified `include()` semantics (vs `/usr/local/bin/ucode`)

`include(path[, scope])` evaluates the target. What becomes visible in the **caller** after
the include:

| child top-level declaration | leaks to caller? |
|---|---|
| **bare assignment** `foo = {...}` (implicit global) | **YES** |
| `function foo() {}` declaration | no |
| `let x` / `const x` | no |

```
// child: function fn_decl(){…}  let let_fn=…  const c=…  global_obj={}
// parent after include():  fn_decl→null  let_fn→null  c→null  global_obj→{ }   ✓ only the bare global
```

**The leaked set is precisely the child file's TOP-LEVEL implicit globals** — the same
notion as `collectImplicitGlobalNames` (see `docs/implicit-global-type-inference.md`),
restricted to `Program.body` statements. (A bare assignment *inside a child function* only
creates its global when that function runs, so it must NOT be merged statically.)

Two-arg form (`include(path, { backend: x })`, uvol:47): the scope object supplies extra
names **to the child**; it does NOT sandbox — the child's own bare globals still leak to the
caller (verified: child `foo="…"` was visible in parent even with a scope arg). So for
**caller-side** analysis, the 1-arg and 2-arg forms merge the same thing: the child's
top-level bare globals. The scope arg only matters when analyzing the child file itself.

This maps cleanly onto the corpus:
- `uci.uc`: `uvol_uci = {...}` (top-level bare global) leaks ✓; `let uci_spooldir`,
  `let init_spooldir = function…` stay local ✓.
- `blockdev_common.uc`: `blockdev_common = {}` + member assigns (lines 165-167) leak ✓;
  the `let X = function…` helpers stay local ✓.

## Fix design — "include() scope merge"

When the analyzer hits `include(<stringLiteral> [, …])`:

1. **Resolve the path.** Relative paths → `FileResolver` (already exists). Absolute runtime
   paths (`/usr/lib/uvol/uci.uc`) won't exist on the dev box, so use a heuristic:
   `dirname(includingFile)/basename(includePath)` first (resolves BOTH corpus cases —
   `uvol`/`lvm.uc` sit beside `uci.uc`/`blockdev_common.uc`), then a workspace-wide basename
   match. A configurable prefix map (`/usr/lib/uvol/` → `packages/utils/uvol/files/`, cf.
   `docs/planned-runtime-introspection.md`) is the robust long-term option. A non-literal
   path (`include(plugin, …)` where `plugin` comes from `fs.glob`, uvol:47) is unresolvable
   — skip silently, never error.

2. **Compute the child's top-level implicit globals** — reuse `collectImplicitGlobalNames`
   but gate to top-level `ExpressionStatement` assignments only.

3. **Declare them in the caller's scope at the include position.** Position-aware so a
   reference *before* the `include()` line stays undefined (uvol's refs are at 38-41, after
   the include at 37 ✓). Type from the child RHS where determinable — `uvol_uci` →
   `object` whose members are `uvol_uci_add/remove/commit/init` (object-literal property
   typing already exists), so `uvol_uci.uvol_uci_add` resolves AND member completion works;
   `blockdev_common` likewise gets `.get_partition`/`.get_bootdev`.

4. **Guards.** Cycle/self-include guard; cap include depth; unresolved path = no-op (no
   false diagnostics).

### Payoff

- `uvol`: 4× UC1001 gone; `uvol_uci.<method>` typed + completable.
- `lvm.uc`: 2× UC1001 gone (line 52); `blockdev_common.<method>` typed.

### Relationship to other docs

This shares machinery with `docs/implicit-global-type-inference.md` (the leaked set = the
child's top-level implicit globals; the RHS-typing step is the same). It is distinct from
ES `import` resolution: `include()` is whole-file evaluation with **shared/leaking scope**,
not named exports, and it carries the absolute-runtime-path resolution problem that imports
don't.
