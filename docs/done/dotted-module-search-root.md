# UC3002 on dotted imports — `import … from "cli.utils"` not resolved

Status: **FIX IMPLEMENTED 0.7.48** (2026-07-02/03, awaiting user verification).

## VERIFIED runtime semantics (vendored source + interpreter, 2026-07-03)

This ticket's "walk ancestor directories" framing was NOT what ucode does. Verified in
compiler.c (`uc_compiler_resolve_module_path` / `uc_compiler_expand_module_path` /
`uc_compiler_canonicalize_path`) and lib.c (`uc_require_path`), confirmed by experiment:

- `import` resolves at COMPILE time. A name containing `/` is importer-relative. A
  bare/dotted name is dots→slashes spliced into each search-path TEMPLATE
  (`<root>/*.uc`); the file must `realpath`-exist. **No ancestor walk exists.**
- Default compiled-in templates (CMakeLists.txt): `<prefix>/lib/ucode/*.so`,
  `<prefix>/share/ucode/*.uc`, `./*.so`, `./*.uc`. The relative `./*.uc` template
  resolves against the IMPORTING FILE's directory (not CWD) for imports; CWD for
  runtime `require()`.
- Resolution never depends on the entry point/call chain — each file's imports resolve
  against the global roots + its own directory. `cli.utils` works on-device ONLY
  because the package is installed under `/usr/share/ucode/` (experiment: running the
  source checkout directly fails "Unable to resolve path"; `-L <root>` succeeds).

## The fix (runtime-faithful heuristic, user-chosen from A/B/C trade-offs)

1. `fileResolver.ts` dotted branch — importer-dir try (faithful to the `./*.uc`
   template), then a walk that treats only ancestors ending in **`share/ucode` or
   `lib/ucode`** as mirrored install roots (deliberately NOT any ancestor: a generic
   walk could resolve imports that fail on-device). Bounded by the workspace root when
   the importer is inside it. Workspace-root-relative try kept (pre-existing).
2. `semanticAnalyzer.ts` — the ticket's root-cause missed that
   `validateAndProcessImportSpecifier` PRE-converts dotted names via
   `convertDotNotationToPath` ("cli.utils" → "./cli/utils.uc"), so `resolveImportPath`
   never saw the dotted form. New `resolveModuleSource()` helper: namespace-prefix
   conversion first, raw dotted fallback (both call sites).

Rejected alternatives: any-ancestor walk (false-negative risk vs runtime); configurable
`.ucode-lsp.json` search roots (fully faithful, deferred — could layer on later, pairs
with docs/cli-defined-globals.md).

## Relative → dotted quick fix (also 0.7.48)

Design question (2026-07-03): should dotted imports get an info diagnostic ("depends on
installation under <root>") with a dotted→relative fix, or is dotted the convention?
Corpus answer: dotted IS the convention — 36 dotted (wifi.*, luci.*, cli.*, unetacl.*)
vs 9 relative intra-package imports, and the relative ones appear exactly where code
installs OUTSIDE a search root (/lib/netifd scripts loaded by explicit path, unetmsg
daemon internals). So: NO diagnostic on dotted imports (would flag upstream-correct
code); instead a diagnostic-independent quick fix on `./`/`../` imports whose target
lies under a share/ucode|lib/ucode mirror root: "Convert to dotted module import
'cli.utils'" (`generateRelativeToDottedImportActions`, server.ts). Gated on a
round-trip: the dotted form must resolve back to the SAME file, so the fix can never
break an import. The reverse fix (dotted→relative) was deliberately NOT added — it
would push against upstream convention, and relative paths don't work with runtime
`require()` at all (template charset rejects '/').

Tests: `tests/imports/test-dotted-module-search-root.test.js` (7 cases incl.
generic-ancestor-must-NOT-resolve and workspace-escape guards). Corpus verified:
network.uc UC3002 cleared; missing modules and wrong named exports still flag.

Known gap (noted 2026-07-03) — **CLOSED in 0.7.49**: `import … from "foo/bar.uc"`
(slash, no `./` prefix) is importer-relative at compile time per
`uc_compiler_resolve_module_path` (any name containing `/` → canonicalize vs importer).
The LSP previously resolved only `./`/`../`/absolute forms; `resolveImportPath` now also
treats any slash-containing non-absolute path as importer-relative.

Status was: **investigated, not implemented.** Date: 2026-06-08.

## Symptom

```js
// openwrt/package/utils/cli/files/usr/share/ucode/cli/modules/network.uc
import { time_format } from "cli.utils";   // UC3002 "Cannot find module 'cli.utils'"
```

The target exists at `.../usr/share/ucode/cli/utils.uc` — i.e. `../utils.uc` from `network.uc`.
A relative `import … from "../utils"` resolves fine; the **dotted** form does not.

## ucode dotted-module semantics

`import … from "cli.utils"` → ucode replaces dots with slashes (`cli/utils.uc` / `cli/utils.so`)
and searches each `REQUIRE_SEARCH_PATH` entry. Installed packages live under
`…/usr/share/ucode/`, so `cli.utils` resolves to `…/usr/share/ucode/cli/utils.uc`. The **search
root** is the `usr/share/ucode` directory — an **ancestor** of the importing file
(`…/usr/share/ucode/cli/modules/network.uc`), not the workspace root or the importer's own dir.

## Root cause

`FileResolver.resolveImportPath` (fileResolver.ts:179-191) already converts the dotted name to
a path, but only tries two roots — neither of which is the search root:

```ts
const dottedPath = importPath.replace(/\./g, '/') + '.uc';        // "cli/utils.uc"
let p = path.resolve(this.workspaceRoot, dottedPath);             // <wsRoot>/cli/utils.uc        ✗
if (fs.existsSync(p)) return …;
p = path.resolve(currentDir, dottedPath);                         // …/cli/modules/cli/utils.uc  ✗
if (fs.existsSync(p)) return …;
return null;                                                      // → UC3002
```

For this file: `workspaceRoot/cli/utils.uc` and `…/cli/modules/cli/utils.uc` both don't exist;
the real file is at `…/usr/share/ucode/cli/utils.uc` (the importer's grandparent + `cli/utils.uc`).

## Fix — walk ancestor directories as search roots

Mirror ucode's search-path resolution: try `<ancestor>/<dottedPath>` for each ancestor of the
importing file's directory (bounded by `workspaceRoot`, or N levels):

```ts
let dir = currentDir;
while (true) {
    const cand = path.resolve(dir, dottedPath);          // …/cli/modules/cli/utils.uc
    if (fs.existsSync(cand)) return this.filePathToUri(cand);
    const parent = path.dirname(dir);
    if (parent === dir || !dir.startsWith(this.workspaceRoot)) break;
    dir = parent;
}
```

For `network.uc` the walk hits `dir = …/usr/share/ucode` → `…/usr/share/ucode/cli/utils.uc` ✓.
This is **sound** — it only ever returns a path that actually exists on disk, so it can't
manufacture a false resolution; it just widens where an existing module can be found.

Optionally also recognize a `usr/share/ucode` segment as a canonical search root (and honor a
configured search-path list from `.ucode-lsp.json`, shared with
`docs/cli-defined-globals.md`), but the ancestor walk alone fixes the reported case and the
general `pkg.sub.mod` form.

### Payoff

Dotted imports between modules of the same installed ucode package (`cli.utils`, `cli.color`,
`cli.context`, and the `u1905.*` family the code comment already references) resolve →
UC3002 cleared, plus go-to-definition / cross-file completion across the package.
