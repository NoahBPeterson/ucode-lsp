# ucode version targeting

ucode has no semver — OpenWrt pins a dated git snapshot of ucode per release. A few
newer syntax features don't compile on older releases, so the LSP can **target** a
specific OpenWrt release and flag syntax that release's ucode would reject.

## The setting

`ucode.targetVersion` (enum, default `25.12`):

| value | ucode snapshot | OpenWrt |
|-------|----------------|---------|
| `main` | newest | main / snapshot |
| `25.12` *(default)* | 2026-01-16 | OpenWrt 25.12 (latest release) |
| `24.10` | 2025-07-18 | OpenWrt 24.10 |
| `23.05` | 2024-07-11 | OpenWrt 23.05 |
| `22.03` | 2022-12-02 | OpenWrt 22.03 |

Default is `25.12` — the latest stable release, what most code is deployed against.
Choose an older release to catch syntax that won't compile there, or `main` to
disable the version checks (reflect the language as it currently is).

## How it works

- The version model + the registry of divergent features live in
  **`src/analysis/ucodeVersions.ts`**. Each `VERSION_FEATURES` entry declares the
  release it was `introducedIn`.
- `SemanticAnalyzer.flagVersionFeature(feature, start, end)` emits **UC6005**
  (warning) only when the configured target is *older* than `feature.introducedIn`.
  The message names the target release and points at `ucode.targetVersion`.
- The diagnostic offers two code actions: the compat fix (e.g. "Add ';'") and
  **"Change ucode target version…"** (a quick-pick, command `ucode.selectTargetVersion`).

### Adding a newly-found divergence

1. Verify it against the oracles (below) — confirm which releases reject it.
2. Add one entry to `VERSION_FEATURES` with its `introducedIn` release.
3. Call `this.flagVersionFeature(VERSION_FEATURES.<id>, start, end)` at the detection
   site. (If detection needs a lexical fact like "was there a trailing `;`", record
   it on the AST node in the parser — don't re-scan source text.)

## Known divergences

| feature | introduced | older releases |
|---------|-----------|----------------|
| `export function f(){}` **without** a trailing `;` | `main` (2026-02-11) | 25.12/24.10/23.05/22.03 require the `;` |
| the `io` module (`import … from 'io'`) | `25.12` (lib/io.c, 2025-11-29) | absent on 24.10/23.05/22.03 |
| `fs.mkdtemp`, `fs.dup2` | `25.12` (2025-11-07) | absent on 24.10/23.05/22.03 |
| `socket.open`, `socket.pair` | `25.12` (2025-08-07) | absent on 24.10/23.05/22.03 |
| the `digest` module (`import … from 'digest'`) | `24.10` (lib/digest.c) | absent on 23.05/22.03 |
| `socket.strerror` | `24.10` | absent on 23.05/22.03 |
| `struct.buffer` | `24.10` | (`struct.new` existed) absent on 23.05/22.03 |
| `zlib.deflater`, `zlib.inflater` | `24.10` | absent on 23.05/22.03 |
| `uloop.guard` | `24.10` | absent on 23.05/22.03 |
| `ubus.open_channel`, `ubus.guard` | `24.10` | absent on 23.05/22.03 |

| `fs.file.ioctl()` (handle method) | `24.10` | absent on 23.05/22.03 |
| `uci.cursor.list_append()` / `list_remove()` (handle methods) | `24.10` | absent on 23.05/22.03 |
| the `debug` / `log` / `socket` / `zlib` modules | `23.05` | absent on 22.03 |
| `fs.pipe`, `nl80211.listener`, `rtnl.listener`, `uloop.interval`, `uloop.signal` | `23.05` | absent on 22.03 |
| `fs.file.isatty()` / `truncate()` / `lock()` (handle methods) | `23.05` | absent on 22.03 |

Module functions are gated at the named-import (`import { mkdtemp } from 'fs'`) and
namespace-member (`fs.mkdtemp()`) sites via `VERSION_MODULE_FUNCTIONS`. Methods on
returned object handles (`f.ioctl()`, `c.list_append()`) are gated via
`VERSION_OBJECT_METHODS`, keyed `objectType.method` and checked in the object-handle
member path — these matter when the handle-creating function (e.g. `fs.open()`,
`cursor()`) predates the method, so nothing else would catch them.

### Known 24.10 → 25.12 differences intentionally NOT gated

Signature/format-level or method-on-object changes that need bespoke detection and
are lower value (source-verified, listed for completeness):

- `math.rand(min, max)` — the 2-arg range form is new; 1-arg `rand()` existed. (Arity gate.)
- `struct` `X`/`Z` format chars — new in the pack/unpack format mini-language.
- `nl80211` listener `.request()` — a method on the object returned by `listener()`;
  the top-level `request()` already existed, so gating the name would false-positive.
- `ubus` channel/request object methods (`request`/`defer`/`await`/`get_fd`/…) and
  `zlib`/`struct` stream/buffer object methods — NOT separately gated because their
  handle-creating constructor IS gated (`ubus.open_channel()`, `zlib.deflater()`,
  `struct.buffer()`), so the usage already flags at the constructor line. (Contrast
  `fs.file.ioctl` / `uci.cursor.list_*`, whose constructors `fs.open()`/`cursor()`
  predate the methods — those ARE gated via `VERSION_OBJECT_METHODS`.)

Optional chaining (`?.`) was reworked internally in 24.10 (commit a616fee) but the
syntax already parsed on 23.05 (oracle-verified), so it is NOT a divergence.

No SYNTAX divergence exists in 22.03→23.05 either: arrow functions, optional chaining,
spread (call/array/object), template literals, rest params, and `**` all parse
identically across 22.03→main (oracle-verified); destructuring and default params are
rejected on every version (correctly). The 22.03→23.05 deltas are all module/
function/method additions. 22.03→23.05 object methods on NEW-constructor types
(nl80211/rtnl listener `close`/`set_commands`; `uloop.interval`/`signal` handle
methods `expirations`/`signo`) are covered by their gated constructors, so not
separately gated.

## Verifying against per-release oracles

Don't trust the system `ucode` binary for syntax — it's an arbitrary (often older)
build. Build the exact ucode each release pins:

```sh
scripts/build-ucode-oracles.sh   # installs ucode_main / ucode25_12 / ucode24_10 / ucode23_05 / ucode22_03
```

Then `tests/test-target-version-gating.test.js` cross-checks the LSP's UC6005 gating
against those binaries: the LSP must flag a target **iff** that version's ucode
rejects the code. (The cross-check auto-skips if the oracles aren't installed.)
