/**
 * Mapping a module registry's declared parameter type STRING to the set of
 * `UcodeType`s an argument may have.
 *
 * The registries (fs, ubus, uci, socket, nl80211, struct, zlib, …) declare
 * parameter types as free-form strings — 199 functions, 176 with parameters —
 * and until now nothing ever checked an argument against them
 * (docs/tc-inferred-param-types-not-checked.md, Part 2). The vocabulary is NOT
 * `UcodeType`:
 *
 *   string(82) number(71) any(43) function(22) integer(18) object(13)
 *   boolean(10) array(6) + unions + handle names (SocketAddress, PollSpec,
 *   fs.stat.perm, module:fs.file, string[], number[], …)
 *
 * Two things matter for soundness:
 *   - `number` is NOT a UcodeType. It means `integer | double`.
 *   - `any` (43 occurrences) and every handle/custom name must be SKIPPED, not
 *     guessed at. Returning `null` means "this parameter has no checkable
 *     contract" — the caller must then validate nothing for that position.
 *
 * A union is checkable only when EVERY member is checkable; one unknown member
 * (`string | number[] | SocketAddress`) disqualifies the whole parameter.
 */

import { UcodeType } from '../symbolTable';

/**
 * Modules whose C implementation uses `args_get_named()` — every function accepts
 * EITHER positional arguments OR a single object of named arguments
 * (`ubus.call({object: "x", method: "y"})`). The registry's positional parameter
 * list cannot express that, so an object first argument looks like a type error
 * when it is the documented calling convention.
 *
 * Verified: `grep -c args_get_named ucode/lib/*.c` → only `lib/ubus.c` (6 sites).
 * `uc_ubus_call` also declares `"object", 0, REQUIRED` — type code `0` = no
 * constraint — and then accepts UC_INTEGER *or* UC_STRING, while the registry says
 * `string`. Two independent reasons the positional contract is not checkable here.
 */
export const MODULES_WITHOUT_POSITIONAL_ARG_CONTRACT: ReadonlySet<string> = new Set(['ubus']);

/** Type strings that map cleanly onto a set of UcodeType bases. */
const ATOMIC: Readonly<Record<string, readonly UcodeType[]>> = {
  string: [UcodeType.STRING],
  integer: [UcodeType.INTEGER],
  double: [UcodeType.DOUBLE],
  // ucode's registries write `number` for "any numeric" — integer OR double.
  number: [UcodeType.INTEGER, UcodeType.DOUBLE],
  boolean: [UcodeType.BOOLEAN],
  object: [UcodeType.OBJECT],
  array: [UcodeType.ARRAY],
  function: [UcodeType.FUNCTION],
  regexp: [UcodeType.REGEX],
  regex: [UcodeType.REGEX],
  null: [UcodeType.NULL],
};

/**
 * The `UcodeType`s an argument for this declared parameter type may have, or
 * `null` when the declaration carries no checkable contract (`any`, a handle
 * type, an array-of shorthand, or any union containing one of those).
 *
 * Deliberately conservative: an unrecognized token disqualifies the parameter
 * rather than being treated as "object" or ignored. A missed diagnostic is a
 * non-event; a false one is a bug report.
 */
export function moduleParamAllowedTypes(typeStr: string | undefined): UcodeType[] | null {
  if (!typeStr) return null;
  const parts = typeStr.split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;

  const out = new Set<UcodeType>();
  for (const part of parts) {
    // `any` is an explicit "no contract"; a handle/custom name (`socketaddress`,
    // `pollspec`, `fs.stat.perm`, `module:fs.file`) and array shorthands
    // (`string[]`, `number[]`) are names we do not model as UcodeType bases.
    const atomic = ATOMIC[part];
    if (!atomic) return null;
    for (const t of atomic) out.add(t);
  }

  // INTEGER and DOUBLE are interchangeable at every numeric module parameter: the C
  // reads them through ucv_int64_get / ucv_to_integer / ucv_to_number, all of which
  // coerce. Verified in ucode/lib/uloop.c: `uc_uloop_timer` does
  // `t = ucv_int64_get(timeout)` and `parse_signo` falls through to
  // `ucv_to_number(sigspec)` — so `uloop.timer(1500.0, cb)` and `uloop.signal(15.0, cb)`
  // are both valid despite the registry declaring `integer` / `string | integer`.
  //
  // This also matters because `integer | double` is frequently SYNTHETIC — the type
  // 0.7.69's arith-on-unknown rule assigns to `u - 1` — so "may be double" would nag
  // about a possibility that only exists because we failed to type the operand.
  if (out.has(UcodeType.INTEGER) || out.has(UcodeType.DOUBLE)) {
    out.add(UcodeType.INTEGER);
    out.add(UcodeType.DOUBLE);
  }
  return [...out];
}
