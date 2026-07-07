# Bare/dotted module names don't find in-package deploy roots (`require("fw4")` / `import 'fw4'` from firewall4)

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.
**Delta ticket** on `docs/tc-module-search-roots-deploy-layout.md` (filed the same day by a parallel
audit slice): that ticket's tier 1 maps **absolute** import paths onto ancestor `files/`/`root/`
deploy roots, and its tier 2 adds configured search roots. This ticket covers the remaining shape:
**bare/dotted search-path NAMES** whose install root lives under the same package's deploy root but
is not an ancestor of the importer.

## The gap

`firewall4/root/` mirrors `/`, so the install root `firewall4/root/usr/share/ucode/` (containing
`fw4.uc`) exists in the workspace — but the consumer `root/usr/share/firewall4/main.uc` is NOT under
it, and the mirror-root walk only climbs the importer's ancestors:

```ucode
// probe placed at firewall4/root/usr/share/firewall4/ (main.uc's directory):
import fw4 from 'fw4';     // → UC3002: Cannot find module 'fw4'   (verified)
// firewall4/root/usr/share/firewall4/main.uc:3 — the real consumer:
let fw4 = require("fw4");  // unknown; resolution is this ticket, require-typing is
                           // docs/tc-require-user-module-typing.md
```

Same layout in `openwrt-firewall4-with-fullcone/` (second vendored copy). The 86-occurrence
`require` cluster (70 reads + 16 decls, `main.uc` alone contributing 80 findings) is gated on this
resolution together with the require-typing ticket.

## Root cause

`src/analysis/fileResolver.ts:662-707` (dotted/bare resolution): candidates are
workspace-root-relative, importer-relative, then `isSearchRootMirror` ancestors — dirs ending
`share/ucode` / `lib/ucode` on the `path.dirname` chain from the importer only (`:692-706`;
deliberate "not any-ancestor" stance, `docs/dotted-module-search-root.md`). From
`root/usr/share/firewall4/`, the chain is `…/share` → `…/usr` → `…/root` → `firewall4/` → workspace —
`root/usr/share/ucode` is a **sibling** of the importer's subtree, never visited.

## Proposed approach

Compose with the peer ticket's tiers — this is its bare-name analog of tier 1:

When the ancestor walk reaches a package deploy root (a dir named `root` or `files`, or the
workspace root), additionally probe `<deployRoot>/usr/share/ucode/<dotted-path>` and
`<deployRoot>/usr/lib/ucode/<dotted-path>` (plus the `/usr/local` pair) — i.e. treat the deploy root
as `/` and expand the runtime's actual search-path templates under it. This stays same-package-only
(no cross-package guessing), is deterministic, and matches on-device behavior by construction:
`/usr/share/ucode/*.uc` IS the default `REQUIRE_SEARCH_PATH` template
(`docs/done/ucode-module-resolution.md`). The tier-2 `searchPaths` config from the peer ticket
remains the escape hatch for unconventional layouts.

Test cases: `import fw4 from 'fw4'` and `require("fw4")` from `root/usr/share/firewall4/` resolve to
`root/usr/share/ucode/fw4.uc`; a name that only exists in ANOTHER package's `root/usr/share/ucode`
stays unresolved; existing ancestor-mirror behavior unchanged.

## Classification

**Solvable** (deterministic same-package path mapping, no config needed for this shape). Gates the
86-occurrence firewall4 `require` cluster (with `docs/tc-require-user-module-typing.md`) ×2 vendored
copies, plus any OpenWrt package using the `root/` payload convention with a `usr/share/ucode`
payload.
