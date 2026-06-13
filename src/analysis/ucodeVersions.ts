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
