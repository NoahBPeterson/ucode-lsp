# ucode module resolution — the complete field guide

> ✅ **RESOLVED (filed 2026-07-04).** The module-resolution suite shipped in **0.7.48**: dotted
> `share/ucode`|`lib/ucode` mirror-root resolution, bare-slash importer-relative imports, UC3008
> (`require("./path")` hard error), UC8009 (relative-`loadfile()` CWD footgun), and `loadfile()()`
> return inference. Retained as the reference field guide; see also `reference-ucode-module-resolution`.

*Everything below is verified against the vendored `ucode/` C source (compiler.c,
lib.c, vm.c, CMakeLists.txt), confirmed by interpreter experiments, and grounded in a
survey of 12 vendored git repositories (2026-07-03). File/line references are to the
vendored checkout.*

## TL;DR — six ways to load code, three resolution behaviors

| Loader | Resolved | Accepts | Relative paths resolve against | Uses search path? | Cached? | On failure |
|---|---|---|---|---|---|---|
| `import … from "a.b"` | **compile time** | dotted / bare names | `./*.uc` template → **importing file's dir** | ✅ | once per program (by canonical path) | syntax error — program won't load |
| `import … from "./f.uc"` | **compile time** | any string with `/` | **importing file's dir** | ❌ | once per program | syntax error — program won't load |
| `import("a.b")` (dynamic) | runtime | dotted / bare names **only** | `./` templates → **process CWD** (launch dir) | ✅ | global `modules` dict | catchable exception |
| `require("a.b")` | runtime | dotted / bare names **only** | `./` templates → **process CWD** (launch dir) | ✅ | global `modules` dict | catchable exception |
| `loadfile("path")` | runtime | filesystem path | **process CWD** (launch dir) | ❌ | never — recompiles every call | catchable exception |
| `include("path", {…})` / `render()` | runtime | filesystem path | **including file's dir** | ❌ | never | catchable exception |

Three details in that table cause most real-world confusion; each gets a section below.

## 1. The search path is a list of *templates*, not directories

`REQUIRE_SEARCH_PATH` entries contain a `*` placeholder. Resolution replaces the `*`
with the module name after converting dots to slashes (`lib.c
uc_require_path`, `compiler.c uc_compiler_expand_module_path`):

```
name "cli.utils"  +  template "/usr/share/ucode/*.uc"  →  /usr/share/ucode/cli/utils.uc
name "fs"         +  template "/usr/lib/ucode/*.so"    →  /usr/lib/ucode/fs.so
```

The compiled-in default (CMakeLists.txt:125, prefix-dependent):

```
/usr/lib/ucode/*.so : /usr/share/ucode/*.uc : ./*.so : ./*.uc
```

Check yours with `ucode -e 'printf("%.J\n", REQUIRE_SEARCH_PATH);'`, extend it with
`-L /some/dir` (expands to `/some/dir/*.so` and `/some/dir/*.uc`) or a full template
like `-L '/opt/*.uc'`.

**Consequence:** a dotted import like `cli.utils` works *only if the package is
installed under a search root* (or `-L` is passed). Running a source checkout
directly fails:

```console
$ ucode files/usr/share/ucode/cli/modules/network.uc
Syntax error: Unable to resolve path for module 'cli.utils'

$ ucode -L "$PWD/files/usr/share/ucode" files/usr/share/ucode/cli/modules/network.uc
(works)
```

## 2. `import` is compile time; `require()` is runtime

A static `import` statement is resolved and compiled into the program **before it
runs** (`compiler.c uc_compiler_compile_module`). A missing module is a *syntax
error* — the whole program never starts. `require()` and dynamic `import(...)`
resolve at call time and throw a *catchable exception*:

```javascript
import { foo } from "maybe.missing";      // missing → program won't even load

let mod = null;
try { mod = require("maybe.missing"); }   // missing → catchable, feature-probing works
catch (e) { }
```

Exception to the exception: importing a **C module** (`import { popen } from 'fs'`)
compiles to a runtime dynload instruction (`I_DYNLOAD`) — the `.so` is located and
`dlopen()`ed when the program starts running, not at compile time.

## 3. The same `./*.uc` template means two different things

This is the sharpest edge in the whole system. The default search path ends with
`./*.so : ./*.uc`, and *who* interprets that template decides what `.` means:

- **Static `import`** (compile time): the compiler canonicalizes the expanded
  template against the **importing file's directory** (`compiler.c
  uc_compiler_canonicalize_path` uses `source->runpath`). So
  `import … from "cli.utils"` inside `/a/b/network.uc` also tries
  `/a/b/cli/utils.uc` — wherever the process was started.
- **`require()` / dynamic `import()`** (runtime): the expanded path is `stat()`ed
  as-is (`lib.c uc_require_ucode`), so `./cli/utils.uc` resolves against the
  **process CWD**.

The same module name in the same file can therefore resolve for `import` and *fail*
for `require`, or vice versa, purely depending on the working directory.

## 4. `require()` can never load by relative path — at all

Template splicing accepts only `[A-Za-z0-9_.]` in module names (`lib.c
uc_require_path` rejects anything else, including `/`). So:

```javascript
import { x } from "./utils.uc";   // ✅ compile-time special case for '/'-containing names
require("./utils.uc");            // ❌ throws: no template ever matches a name with '/'
```

This asymmetry is why **converting a dotted import to a relative one is not a
refactor-safe transformation** in general: if that module is *also* loaded via
`require()` somewhere (initscripts, plugin loaders, REPL), the dotted name is the
only spelling that works there.

Static `import` has the mirror-image rule: any source string containing `/` skips
the search path entirely and resolves against the importing file's directory
(`compiler.c uc_compiler_resolve_module_path`, first branch). The extension must be
written out — nothing appends `.uc` for you — and the file must exist at load time.

## 5. `loadfile()` and `include()` don't use the search path at all

- **`loadfile(path)`** is raw file access: absolute path, or relative **to the
  ucode process's working directory** — wherever the shell or init script that
  *launched* ucode was standing, NOT the entry script's directory and NOT the
  calling file's directory (`lib.c uc_loadfile` → `uc_source_new_file` →
  `fopen`; verified: the same script succeeds or fails purely by the launch
  directory). It returns the compiled program as a function *without running
  it* — calling it is the plugin-loading idiom:

  ```javascript
  // netifd (openwrt/package/network/config/netifd/files/lib/netifd/main.uc:80)
  wireless = loadfile(wireless_module)();   // absolute path built at runtime
  ```

  **Footgun:** `loadfile("lib/x.uc")` works when you launch ucode from your project
  directory and throws when procd launches the same script with CWD=`/`. Use an
  absolute path (the corpus idiom), or make it file-relative at runtime with
  `sourcepath(0, true) + "/lib/x.uc"` — `sourcepath(depth, dirname)` returns the
  current source file's directory, verified to work from any launch dir. ucode-lsp
  flags relative literal `loadfile()` paths as **UC8009** with both rewrites as
  quick fixes.

- **`include(path, scope?)`** (and `render()`) resolve a relative path against the
  **including file's directory** (`lib.c include_path` uses the calling closure's
  source `runpath`) — the only *runtime* loader that is file-relative. The optional
  scope dictionary becomes the included file's global environment:

  ```javascript
  // firewall4 templates (root/usr/share/firewall4/templates/ruleset.uc)
  {%+ include("rule.uc", { fw4, zone, rule }) %}
  ```

- Neither caches: `loadfile`/`include` recompile on every call. `require()` caches
  in the global `modules` dictionary (delete a key to force reload; pre-seed a key
  to inject a virtual module). Static imports are deduplicated per program by
  canonical path — two files importing `cli.utils` share one module instance.

## What real code actually does — survey of 12 repos

Counted over `*.uc` files plus extensionless ucode-shebang scripts (occurrences of
`import … from`, by source-string shape; `require()` split by name shape):

| Repo | ucode files | import: relative | import: dotted | import: bare | import: absolute | require (bare/dotted) | loadfile | include |
|---|---|---|---|---|---|---|---|---|
| openwrt | 48 | **9** | 23 | 71 | **2** | 5 / 1 | 4 | 1 |
| luci | 30 | 0 | 16 | 59 | 0 | 1 / 0 | 3 | 1 |
| utest | 82 | 0 | **45** | 55 | 0 | 2 / 1 | 4 | 0 |
| unetacl | 4 | 0 | 4 | 10 | 0 | 3 / 1 | 0 | 0 |
| uspot | 11 | 0 | 0 | 5 | 0 | **24** / 0 | 0 | 25 |
| firewall4 | 17 | 0 | 0 | 0 | 0 | 6 / 0 | 0 | **43** |
| packages | 44 | 0 | 0 | 14 | 0 | 4 / 0 | 1 | 8 |
| mwan4 | 11 | 0 | 0 | 12 | 0 | 3 / 0 | 0 | 0 |
| pbr | 17 | 0 | 0 | 9 | 0 | 6 / 0 | 0 | 0 |
| adblock-fast | 5 | 0 | 0 | 4 | 0 | 1 / 0 | 0 | 0 |
| owrt-fullcone | 16 | 0 | 0 | 0 | 0 | 6 / 0 | 0 | 39 |
| ucode (own) | 1 | 0 | 0 | 1 | 0 | 0 / 0 | 0 | 0 |

**Path-shaped imports across all repos: 9 relative, 88 dotted, 2 absolute (91%
dotted).** But the more interesting finding is that the *choice is not stylistic* —
it tracks **where the code installs**:

- **Dotted** = the package installs under a search root. `wifi.common`, `luci.http`,
  `cli.utils`, `unetacl.core`, `utest.assert` — all live under
  `files/usr/share/ucode/<pkg>/` in their repos, i.e. `/usr/share/ucode/<pkg>/`
  on-device.
- **Bare** single-level names split two ways: C builtins (`fs` ×72, `uci` ×30,
  `ubus` ×20, `uloop` ×11) and *single-file packages* installed directly under the
  search root (`utest` ×30 → `/usr/share/ucode/utest.uc`; `mwan4` ×12; uspot's
  `require('portal')`, `require('uspotlib')`). Mechanically identical to dotted —
  just zero dots.
- **Relative** (all 9 in the openwrt repo) = code that installs *outside* any search
  root and is loaded by explicit path, not by name: netifd's `/lib/netifd/*.uc`
  (`import * as wdev from "./wireless-device.uc"`) and the unetmsg daemon's
  internals. `/lib/netifd` is not on `REQUIRE_SEARCH_PATH`, so dotted names can't
  reach these files; importer-relative paths keep working no matter how the tree
  was loaded.
- **Absolute** (hostap): `import { … } from "/usr/share/hostap/common.uc"` —
  same reason as relative (`/usr/share/hostap` isn't a search root) but with a
  fixed install location, so the code hardcodes it.
- **`include()`-heavy repos** (firewall4 ×43, uspot ×25) aren't importing modules at
  all — they're stitching **templates** together with injected scopes
  (`include("rule.uc", { fw4, zone, rule })`), which is a different job: fragment
  expansion with parameters, not symbol import.

## Decision guide

- Package installs under `/usr/share/ucode/<pkg>/`? → **dotted** (`pkg.mod`), the
  ecosystem convention. Works for `import`, `require`, and dynamic `import()` alike.
- Single-file library under `/usr/share/ucode/`? → **bare** name (`utest`, `portal`).
- Code lives outside the search path and is loaded by path (plugins, netifd-style
  handlers)? → **relative `import "./x.uc"`** between siblings; `loadfile(abs)()`
  from the loader side.
- Fixed non-search-root install dir shared by several consumers? → **absolute**
  import (the hostap pattern).
- Optional dependency / feature probe? → `try { require("x") } catch {}` — the only
  form that fails softly.
- Template fragments with parameters? → `include("frag.uc", { scope })`.
- Never spell a module `./…` in `require()` — it cannot work; and if a module is
  consumed via `require()` anywhere, keep a dotted/bare name for it everywhere.

## How ucode-lsp models this (as of 0.7.48)

- Relative imports: importer-relative only, extension required, no workspace-root
  fallback — matching the compiler exactly.
- Dotted/bare imports: tried against the workspace root, the importer's directory
  (mirrors the `./*.uc` template), and ancestor directories ending in
  `share/ucode`/`lib/ucode` (a mirror of the install-prefix templates, since the
  LSP can't know deploy-time `-L` flags). Deliberately *not* any-ancestor: the
  runtime only searches configured roots.
- A quick fix offers `./`-relative → dotted conversion when the target sits under
  such a mirrored root and the dotted form provably resolves to the same file. The
  reverse (dotted → relative) is deliberately not offered — see §4.
- **UC3008** (error): `require("./path")` — can never resolve (§4), flagged even
  inside try/catch, with `import`/`loadfile()` suggested.
- **UC8009** (warning): relative literal `loadfile()` path — the CWD footgun above;
  quick fixes rewrite to `sourcepath(0, true) + "/…"` or the deployed absolute path.
- `loadfile("x.uc")()` bindings get the loaded program's top-level return type
  (object shapes included); path completion in `loadfile()`/`include()` strings
  handles bare, `./`, nested, and absolute shapes.

## Appendix: primary sources

| Claim | Where |
|---|---|
| Template expansion, dots→slashes | `ucode/lib.c` `uc_require_path`; `ucode/compiler.c` `uc_compiler_expand_module_path` |
| Compile-time import resolution, `/` = importer-relative | `ucode/compiler.c` `uc_compiler_resolve_module_path` |
| `./` template importer-relative for import | `ucode/compiler.c` `uc_compiler_canonicalize_path` (uses `source->runpath`) |
| `require` name charset `[A-Za-z0-9_.]` | `ucode/lib.c` `uc_require_path` name loop |
| `modules` cache | `ucode/lib.c` `uc_require_path` / `require()` docstring |
| Dynamic `import()` = runtime dynload | `ucode/compiler.c` `uc_compiler_compile_importcall` → `I_DYNLOAD`; `ucode/vm.c` `uc_vm_insn_dynload` → `uc_require_library` |
| `loadfile` = raw fopen, CWD | `ucode/lib.c` `uc_loadfile` → `uc_source_new_file` |
| `include` relative to including file | `ucode/lib.c` `include_path` |
| Default search path | `ucode/CMakeLists.txt:125` `LIB_SEARCH_PATH` |
