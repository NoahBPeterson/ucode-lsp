/**
 * ucode target-version model + the registry of version-divergent language
 * features.
 *
 * ucode has no semver — OpenWrt pins a dated git snapshot per release. The LSP
 * targets the NEWEST grammar by default ('main'); when the user configures an
 * older `ucode.targetVersion`, any syntax/feature introduced AFTER that release
 * is flagged (it would fail to compile on the target's older ucode).
 *
 * To add a newly-discovered divergence: add ONE entry to `VERSION_FEATURES`
 * (with the release it was `introducedIn`) and call `analyzer.flagVersionFeature`
 * at the detection site. The gating + messaging is handled centrally.
 *
 * Verify a divergence with the locally-built oracles
 * (`ucode22_03`/`ucode23_05`/`ucode24_10`/`ucode_main` on PATH), not the system
 * `ucode` binary (which is an arbitrary, often-older build).
 */

/** Supported ucode targets, OLDEST → NEWEST. Index is the version ordering. */
export const UCODE_TARGET_VERSIONS = ['22.03', '23.05', '24.10', '25.12', 'main'] as const;
export type UcodeTargetVersion = typeof UCODE_TARGET_VERSIONS[number];

/** The default target when `ucode.targetVersion` is unset: the latest OpenWrt
 *  release (not bleeding-edge `main`). */
export const DEFAULT_TARGET_VERSION: UcodeTargetVersion = '25.12';

/** OpenWrt release → the ucode git snapshot date it pins (for diagnostics/help). */
export const UCODE_SNAPSHOT_DATES: Record<UcodeTargetVersion, string> = {
  '22.03': '2022-12-02',
  '23.05': '2024-07-11',
  '24.10': '2025-07-18',
  '25.12': '2026-01-16',
  'main': 'newest',
};

/** `true` when `target` is older than `introduced` (so it lacks that feature). */
export function targetLacksFeature(target: UcodeTargetVersion, introduced: UcodeTargetVersion): boolean {
  return UCODE_TARGET_VERSIONS.indexOf(target) < UCODE_TARGET_VERSIONS.indexOf(introduced);
}

/**
 * Builtin MODULES → the release they were introduced in. Importing the module on
 * an older target is flagged (it cannot be loaded there).
 *
 * The gate is **feed availability** — the first OpenWrt release whose package feed
 * ships the `ucode-mod-<name>` package — NOT mere source-tree existence. A module
 * loads as a shared `.so` plugin at runtime, so what matters for a script targeting
 * a release is whether that release can actually install/import it. Source existence
 * is necessary but not sufficient: e.g. `lib/socket.c` and `lib/zlib.c` existed in
 * the 23.05 ucode tree, but the `ucode-mod-socket` package first shipped in 24.10 and
 * `ucode-mod-zlib` only in 25.12 — so `import … from "socket"` on 23.05 fails at
 * runtime ("No module named 'socket'"). Gating on source would be a false negative.
 *
 * Ground-truthed (2026-06) against the real per-release package feeds via the
 * `openwrt/rootfs` aarch64 containers (opkg for 22.03–24.10, apk for 25.12):
 *   22.03 feed: fs math nl80211 resolv rtnl struct ubus uci uloop
 *   23.05 feed: + bpf debug html log lua
 *   24.10 feed: + digest socket uclient udebug
 *   25.12 feed: + io zlib uline pkgen
 * The 22.03-floor modules (fs/math/nl80211/resolv/rtnl/struct/ubus/uci/uloop) need
 * no entry here — they exist on the oldest supported target.
 */
export const VERSION_MODULES: Record<string, UcodeTargetVersion> = {
  // First feed appearance 25.12 (apk `ucode-mod-io`). lib/io.c also only landed
  // 2025-11-29, after the 24.10 snapshot — source and feed agree here.
  io: '25.12',
  // First feed appearance 25.12 (`ucode-mod-zlib`). NOTE: lib/zlib.c existed since the
  // 23.05 source tree, but no zlib module package was built until 25.12 — feed wins.
  zlib: '25.12',
  // First feed appearance 25.12 (`ucode-mod-{uline,pkgen}`). External feed packages
  // (own repos), so feed availability is the only minimum.
  uline: '25.12',
  pkgen: '25.12',
  // First feed appearance 24.10 (`ucode-mod-{digest,uclient,udebug}`); absent at 23.05.
  digest: '24.10',
  uclient: '24.10',
  udebug: '24.10',
  // First feed appearance 24.10 (`ucode-mod-socket`). NOTE: lib/socket.c existed since
  // the 23.05 source tree, but no socket module package was built until 24.10.
  socket: '24.10',
  // First feed appearance 23.05 (`ucode-mod-{debug,log,bpf,html,lua}`); absent from
  // the 22.03 feed.
  debug: '23.05',
  log: '23.05',
  bpf: '23.05',
  html: '23.05',
  lua: '23.05',
};

/**
 * Builtin MODULE FUNCTIONS → the release they were introduced in, keyed
 * `"module.function"`. Importing or calling the function on an older target is
 * flagged. Source-verified from the function-list tables at each pinned hash.
 *
 * Only function-EXISTENCE additions belong here. Signature/format-level changes
 * (e.g. `math.rand`'s 2-arg form, `struct`'s X/Z format chars) and methods on
 * returned objects (e.g. nl80211 listener `.request()`, where the top-level
 * `request` already existed) need bespoke gating and are intentionally omitted.
 */
export const VERSION_MODULE_FUNCTIONS: Record<string, UcodeTargetVersion> = {
  // Added 2025-11-07, after the 24.10 snapshot.
  'fs.mkdtemp': '25.12',
  'fs.dup2': '25.12',
  // Added 2025-08-07, after the 24.10 snapshot.
  'socket.open': '25.12',
  'socket.pair': '25.12',

  // --- fs ioctl direction constants: ucode commit 18a2ffa (2024-10-11), first feed 24.10 ---
  // (container-verified: `import { IOC_DIR_READ } from 'fs'` is a Reference error on 23.05,
  // works on 24.10/25.12/main. The fs.file.ioctl METHOD is gated in VERSION_OBJECT_METHODS.)
  'fs.IOC_DIR_NONE': '24.10',
  'fs.IOC_DIR_READ': '24.10',
  'fs.IOC_DIR_WRITE': '24.10',
  'fs.IOC_DIR_RW': '24.10',

  // --- 23.05 → 24.10 additions (module-level functions; absent at the 23.05 hash) ---
  // NOTE: socket.* and zlib.* function gates are covered by the MODULE gates above
  // (socket → 24.10, zlib → 25.12 by feed availability); a function gate at or below
  // its module's gate is dead, so socket.strerror / zlib.deflater / zlib.inflater are
  // intentionally omitted here (the whole module is already unavailable earlier).
  'struct.buffer': '24.10',     // struct.new existed in 23.05; struct.buffer is new
  'uloop.guard': '24.10',
  'ubus.open_channel': '24.10',
  'ubus.guard': '24.10',

  // --- 22.03 → 23.05 additions (module-level functions; absent at the 22.03 hash) ---
  'fs.pipe': '23.05',
  'nl80211.listener': '23.05',
  'rtnl.listener': '23.05',
  'uloop.interval': '23.05',
  'uloop.signal': '23.05',

  // --- fs statvfs ST_* mount-flag constants: modeled as `main`-only ---
  // These are `#ifdef ST_<name>`-guarded C macros in lib/fs.c (libc-dependent), and are
  // ABSENT on every released OpenWrt build — OpenWrt's musl doesn't define them, so
  // `exists(fs, "ST_RDONLY")` is false on 22.03/23.05/24.10/25.12 (container-verified).
  // They only appear on a glibc/from-source build. So they're flagged on all concrete
  // releases and tolerated only under the `main` (checks-relaxed) target. Reaching them
  // portably means testing `statvfs(path).flag & <bit>` with a literal bit, not the const.
  'fs.ST_RDONLY': 'main', 'fs.ST_NOSUID': 'main', 'fs.ST_NODEV': 'main',
  'fs.ST_NOEXEC': 'main', 'fs.ST_SYNCHRONOUS': 'main', 'fs.ST_MANDLOCK': 'main',
  'fs.ST_NOATIME': 'main', 'fs.ST_NODIRATIME': 'main', 'fs.ST_RELATIME': 'main',
  'fs.ST_NOSYMFOLLOW': 'main',
};

/**
 * METHODS on builtin object handles → the release they were introduced in, keyed
 * `"objectType.method"` (e.g. `"fs.file.ioctl"`, `"uci.cursor.list_append"`). These
 * live on the type RETURNED by a constructor (fs.open(), cursor(), …); when that
 * constructor predates the method, this is the only place the version gap is caught
 * (the module-function gating can't see methods on a local handle variable).
 * Source-verified from the function-list tables at each pinned hash.
 */
export const VERSION_OBJECT_METHODS: Record<string, UcodeTargetVersion> = {
  // fs.file.ioctl added in 24.10 (fs.open() existed in 23.05, so otherwise silent).
  'fs.file.ioctl': '24.10',
  // uci.cursor list mutators added in 24.10 (cursor() existed in 23.05).
  'uci.cursor.list_append': '24.10',
  'uci.cursor.list_remove': '24.10',
  // fs.file methods added in 23.05 (fs.open() existed in 22.03, so otherwise silent).
  'fs.file.isatty': '23.05',
  'fs.file.truncate': '23.05',
  'fs.file.lock': '23.05',
};

/**
 * GLOBAL builtin functions → the release they were introduced in. Calling the builtin on
 * an older target is flagged: the global simply isn't in that release's scope (a bare call
 * resolves to null → "not a callable value" at runtime).
 *
 * Ground-truthed (2026-06) by introspecting the built-in `global` scope on each release's
 * ucode (`for (k in global) print(type(global[k]), k)` via the `openwrt/rootfs` containers):
 * the global scope is IDENTICAL across 22.03→main EXCEPT `signal`, which 22.03 lacks.
 * (NB: this is the top-level `signal()` builtin — distinct from the `uloop.signal` module
 * function, which is gated separately in VERSION_MODULE_FUNCTIONS.)
 */
export const VERSION_GLOBAL_BUILTINS: Record<string, UcodeTargetVersion> = {
  signal: '23.05',
};

/**
 * Module symbols (functions/constants/methods) that ucode only compiles on a specific
 * PLATFORM, keyed `"module.symbol"` → the platform they require. Unlike version gating,
 * these exist on the newest ucode but are `#ifdef`'d out on other OSes, so importing/using
 * one is fine on the gated platform (OpenWrt is Linux) but absent on, e.g., a macOS/BSD
 * build. Surfaced as an INFO diagnostic (UC6006), not an error — it's a portability note.
 *
 * Source: ucode `lib/io.c` gates `_IOC_*` (and the io ioctl method) behind
 * `#if defined(__linux__)` → `#ifdef HAS_IOCTL`. The IOC_DIR_* constants use Linux's
 * `<sys/ioctl.h>` `_IOC_NONE/_IOC_READ/_IOC_WRITE` encoding, absent on non-Linux.
 */
export const PLATFORM_GATED_SYMBOLS: Record<string, 'Linux'> = {
  'io.IOC_DIR_NONE': 'Linux',
  'io.IOC_DIR_READ': 'Linux',
  'io.IOC_DIR_WRITE': 'Linux',
  'io.IOC_DIR_RW': 'Linux',
};

export interface VersionGatedFeature {
  /** Stable id (also the diagnostic's `data.feature`). */
  id: string;
  /** The OLDEST target release in which this syntax/feature is valid. */
  introducedIn: UcodeTargetVersion;
  /** Human description of the feature, used to open the diagnostic message. */
  label: string;
  /** What to do to stay compatible with an older target. */
  remedy: string;
}

/**
 * The registry of version-divergent ucode features. Verified against the
 * per-release oracles. Keep this the single source of truth.
 */
export const VERSION_FEATURES = {
  /** `export function f(){}` without a trailing `;`. Valid on main; on 25.12 and
   *  earlier the `;` is required (`Syntax error: Unexpected token, Expecting ';'`).
   *  Introduced 2026-02-11 ("compiler: allow export function declarations without
   *  trailing semicolon"), after the 25.12 snapshot (2026-01-16). Confirmed err on
   *  the ucode25_12/ucode24_10 oracles, ok on ucode_main. */
  exportFunctionNoSemicolon: {
    id: 'export-function-no-semicolon',
    introducedIn: 'main',
    label: 'An `export function` declaration without a trailing `;`',
    remedy: 'add a `;` after the function',
  },
} as const satisfies Record<string, VersionGatedFeature>;
