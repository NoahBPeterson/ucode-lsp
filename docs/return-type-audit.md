# Return Type Audit: C Source vs LSP Definitions

Audit of all ucode C source files against LSP type definitions to ensure return types
accurately reflect the C implementation, particularly around null returns.

## Key Concepts

- **`nullMeansWrongType`**: When `true` on an fs module function, null in the return type
  means ONLY "wrong argument type was passed". When arguments are provably correct, null
  can be eliminated from the return type. When absent/false, null can occur at runtime
  even with correct argument types (e.g., file not found, connection refused).

- **`ObjectType`** (new): Known object types like `fs.file`, `uci.cursor` are now first-class
  in the type system via `ObjectType { type: 'objectKind', name: string }`, participable in unions.

## Completed Work

### glob() — argument-aware return narrowing

Added `narrowFsReturnType()` in `typeChecker.ts` which narrows fs module return types
based on actual argument types when `nullMeansWrongType: true`:

- `glob("string_literal")` → `array` (null eliminated — arg is definitely string)
- `glob(unknownVar)` → `array | null` (arg might not be string)
- `glob(null)` → `null` (arg is definitely not string)
- `glob(123)` → `null` (arg is definitely not string)

This pattern can be extended to other fs functions where null strictly means wrong arg type.

---

## fs module (`ucode/lib/fs.c` → `src/analysis/fsModuleTypes.ts`)

### Incorrect Return Types — FIXED in 0.6.20

- [x] **`mkdir`** — Fixed: `boolean | null`.
- [x] **`rmdir`** — Fixed: `boolean | null`.
- [x] **`unlink`** — Fixed: `boolean | null`.
- [x] **`access`** — Fixed: `boolean | null`. Mode param fixed to `string`.
- [x] **`writefile`** — Fixed: `integer | null`.

### Incorrect Parameter Types

- [x] **`access`** — Fixed: mode param is now `string`.
- [x] **`chown`** — Fixed: uid/gid now `number | string | null`.
- [x] **`readfile`** — Fixed: optional second `size` (integer) parameter added.

### nullMeansWrongType Candidates — ALL DONE

- [x] **`glob`** — Done. Returns `array<string>` for valid string args; null on non-string arg.
- [x] **`dirname`** — Done. Returns string for string input; null on non-string arg.
- [x] **`basename`** — Done. Same as dirname.

### Duplicate Map Entries — FIXED in 0.6.20

- [x] Removed duplicates for `getcwd`, `chdir`, `rename`, `symlink`, `glob`.

---

## Global Builtins (`ucode/lib.c` → `src/analysis/typeChecker.ts` initializeBuiltins)

### High Priority — ALL FIXED in 0.6.19

- [x] **`length`** — Fixed: `integer | null`, narrowable (string/array/object → integer).
- [x] **`type`** — Fixed: `string | null`, narrowed when arg non-null.
- [x] **`ord`** — Fixed: `integer | null`.
- [x] **`index`** — Fixed: `integer | null`, narrowable (string/array arg1 → integer).
- [x] **`rindex`** — Fixed: `integer | null`, narrowable.
- [x] **`b64dec`** — Fixed: `string | null`.
- [x] **`hexdec`** — Fixed: `string | null`.
- [x] **`iptoarr`** — Fixed: `array<integer> | null`.
- [x] **`arrtoip`** — Fixed: `string | null`.
- [x] **`timelocal`** — Fixed: `integer | null`.
- [x] **`timegm`** — Fixed: `integer | null`.
- [x] **`getenv`** — Fixed: 0 args → `object`, 1 arg → `string | null`.
- [x] **`sourcepath`** — Fixed: `string | null`.
- [x] **`clock`** — Fixed: `array | null`.

### Medium Priority — ALL FIXED in 0.6.19 with nullMeansWrongType narrowing

- [x] **`substr`** — Fixed: `string | null`, narrowable.
- [x] **`join`** — Fixed: `string | null`, narrowable (arg2 array → string).
- [x] **`trim`** — Fixed: `string | null`, narrowable.
- [x] **`ltrim`** — Fixed.
- [x] **`rtrim`** — Fixed.
- [x] **`keys`** — Fixed: `array<string> | null`, narrowable.
- [x] **`values`** — Fixed: `array | null`, narrowable.
- [x] **`filter`** — Fixed: `array | null`.
- [x] **`map`** — Fixed: `array | null`.
- [x] **`uniq`** — Fixed: `array | null`, narrowable.
- [x] **`b64enc`** — Fixed: `string | null`, narrowable.
- [x] **`hexenc`** — Fixed: `string | null`, narrowable.
- [x] **`replace`** — Fixed: `string | null`, narrowable.
- [x] **`wildcard`** — Fixed: `boolean | null`, narrowable.
- [x] **`system`** — Fixed: `integer | null`.
- [x] **`localtime`** — Fixed: `object | null`.
- [x] **`gmtime`** — Fixed: `object | null`.
- [x] **`loadstring`** — Fixed: `function | null`.
- [x] **`loadfile`** — Fixed: `function | null`.
- [x] **`render`** — Fixed: `string | null`.

### Wrongly-Typed (not null-related) — ALL FIXED in 0.6.19-0.6.21

- [x] **`gc`** — Fixed: value-based narrowing (collect/stop → boolean, count → integer).
- [x] **`trace`** — Fixed: `integer | null`.
- [x] **`sort`** — Fixed: accepts arrays and objects, wrong types → null.
- [x] **`hex`** — Fixed: `integer | double`. Narrowing: string→integer|double, non-string→double (NaN).
- [x] **`int`** — Fixed: `integer | double`. Narrowing: integer/double/boolean/null→integer, array/object/function/regex→double (NaN), string→integer|double.

---

## io module (`ucode/lib/io.c` → `src/analysis/ioTypes.ts`)

- [x] ~~**`io.new()`**~~ — `takeOver` parameter is correctly marked `optional: true`. No fix needed.

---

## uloop module (`ucode/lib/uloop.c` → `src/analysis/uloopTypes.ts`)

All return types match. No changes needed.

---

## ubus module (`ucode/lib/ubus.c` → `src/analysis/ubusTypes.ts`)

- [x] **`ubus.connect()`** — Fixed: `object | null`.
- [x] **`ubus.open_channel()`** — Fixed: `object | null`.
- [x] **`ubus.guard()`** — Fixed: `function | boolean | null`.

---

## uci module (`ucode/lib/uci.c` → `src/analysis/uciTypes.ts`)

All return types match. No changes needed.

---

## debug module (`ucode/lib/debug.c` → `src/analysis/debugTypes.ts`)

- [x] **`debug.traceback()`** — Fixed: `StackTraceEntry[] | null`.

All other debug functions match (memdump, sourcepos, getinfo, getlocal, setlocal, getupval, setupval).

---

## math module (`ucode/lib/math.c` → `src/analysis/mathTypes.ts`)

All return types match. No changes needed.

---

## resolv module (`ucode/lib/resolv.c` → `src/analysis/resolvTypes.ts`)

- [x] **`resolv.query()`** — Fixed: `object | null`.

---

## struct module (`ucode/lib/struct.c` → `src/analysis/structTypes.ts`)

- [x] **`struct.pack()`** — Fixed: `string | null`.
- [x] **`struct.unpack()`** — Fixed: `array | null`.
- [x] **`struct.new()`** — Fixed: `struct.instance | null`.
- [x] **`struct.buffer()`** — Fixed: `struct.buffer | null`.

---

## digest module (`ucode/lib/digest.c` → `src/analysis/digestTypes.ts`)

All return types match. No changes needed.

---

## rtnl module (`ucode/lib/rtnl.c` → `src/analysis/rtnlTypes.ts`)

- [x] **`rtnl.request()`** — Fixed: `object | array | boolean | null`.
- [x] **`rtnl.listener()`** — Fixed: `rtnl.listener | null`.

---

## nl80211 module (`ucode/lib/nl80211.c` → `src/analysis/nl80211Types.ts`)

- [x] **`nl80211.request()`** — Fixed: `object | array | boolean | null`.
- [x] **`nl80211.listener()`** — Fixed: `nl80211.listener | null`.

---

## log module (`ucode/lib/log.c` → `src/analysis/logTypes.ts`)

All return types match. No changes needed.

---

## socket module (`ucode/lib/socket.c` → `src/analysis/socketTypes.ts`)

### Missing Function Definitions

- [x] **`socket.pair()`** — Fixed: added function definition. Returns `array | null`.
- [x] **`socket.open()`** — Fixed: added function definition. Returns `socket | null`.

### Minor

- `socket.strerror()` — LSP says `string | null` but C always returns a string. Overly conservative but harmless.

---

## zlib module (`ucode/lib/zlib.c` → `src/analysis/zlibTypes.ts`)

All return types match. No changes needed.
