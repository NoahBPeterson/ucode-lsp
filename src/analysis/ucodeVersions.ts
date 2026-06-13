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
 * an older target is flagged (it doesn't exist there). Source-verified against the
 * per-release ucode trees (the module's `lib/*.c` is absent at older hashes).
 *
 * NOTE: module functions load as shared `.so` plugins at runtime, so the per-
 * version oracle *binaries* can't verify module availability — confirm these from
 * the ucode SOURCE at each release's pinned hash (package/utils/ucode/Makefile).
 */
export const VERSION_MODULES: Record<string, UcodeTargetVersion> = {
  // lib/io.c introduced 2025-11-29 (commit 559860c), after the 24.10 snapshot
  // (2025-07-18) and absent from that tree. First shipped in 25.12.
  io: '25.12',
  // lib/digest.c absent at the 23.05 hash; first shipped in 24.10.
  digest: '24.10',
  // lib/{debug,log,socket,zlib}.c absent at the 22.03 hash; first shipped in 23.05.
  debug: '23.05',
  log: '23.05',
  socket: '23.05',
  zlib: '23.05',
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

  // --- 23.05 → 24.10 additions (module-level functions; absent at the 23.05 hash) ---
  'socket.strerror': '24.10',
  'struct.buffer': '24.10',     // struct.new existed in 23.05; struct.buffer is new
  'zlib.deflater': '24.10',     // streaming API (deflater/inflater objects)
  'zlib.inflater': '24.10',
  'uloop.guard': '24.10',
  'ubus.open_channel': '24.10',
  'ubus.guard': '24.10',

  // --- 22.03 → 23.05 additions (module-level functions; absent at the 22.03 hash) ---
  'fs.pipe': '23.05',
  'nl80211.listener': '23.05',
  'rtnl.listener': '23.05',
  'uloop.interval': '23.05',
  'uloop.signal': '23.05',
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
