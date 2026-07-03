# UC3002 on dotted imports — `import … from "cli.utils"` not resolved

Status: **investigated, not implemented.** Date: 2026-06-08.

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
