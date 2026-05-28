/**
 * CheckResult — the return type of every `check*` method in TypeChecker.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Before: `checkNode()` returned `UcodeType` (a flat enum). A computed result
 * that genuinely was a union (e.g. `arr[i]` → `STRING | NULL`) couldn't fit
 * through that return slot, so the code projected it down to `UcodeType.UNKNOWN`
 * and stashed the real union on `(node as any)._fullType` as a side channel.
 *
 * Anywhere a consumer read only the return value, the union information
 * silently disappeared. Recurring bug class — at least four shipped releases
 * patched individual misses (0.6.80, 0.6.83, 0.6.86).
 *
 * THE FIX
 * -------
 * `CheckResult` is just the rich `UcodeDataType` (which CAN express unions,
 * arrays, object shapes). The alias exists for documentation: when a function
 * returns `CheckResult`, the caller is on notice that the value MAY be a
 * union/array/object — they cannot use it as a flat `UcodeType` without
 * deliberately handling all variants.
 *
 * The static enforcement is Match.exhaustive at every consumer site. If a new
 * variant is added to `UcodeDataType` (e.g. a future `RecordType`), every
 * Match.exhaustive site fails to compile until updated.
 *
 * REMOVING `_fullType`
 * --------------------
 * Once every consumer reads the return value (which IS the rich type), the
 * side-channel `_fullType` AST mutation has no readers. Hover/completion that
 * previously read `(node as any)._fullType` will read from a typed accessor
 * exposed on `SemanticAnalysisResult` instead.
 */

import type { UcodeDataType } from './symbolTable';

/** The return type of every `check*` method. Same as `UcodeDataType` — the
 *  alias exists to make the convention visible at call sites. */
export type CheckResult = UcodeDataType;
