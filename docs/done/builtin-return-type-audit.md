> 🟡 **PARTIAL** (2026-06-15 triage). Done: `writefile` returnType `integer | null` (fsModuleTypes.ts:270, was boolean); `validateOrdFunction`/`validateB64decFunction`/`validateTrimFunction` with narrowForArgType (builtinValidation.ts:1478/1547/1959).
>
> **2026-07 update (batch L2).** `rand` and `getopt` resolved as honest unions (arg-count / per-constant narrowing has no clean module-function mechanism):
> - `rand` → returnType `integer | double` (mathTypes.ts). Verified `uc_rand` (math.c): rand() DOES take optional args (`a`, `b`) — 0 args → `ucv_int64_new(rand())` (integer), any args → `ucv_double_new(...)` (double). The prior `number` collapsed to integer (wrong for the with-args double case). Per-arg-count narrowing DEFERRED: module functions resolve return type via `parseReturnType`/`narrowFsReturnType`, which only does null-elimination — there is no arg-count→return-type hook without a bespoke special-case.
> - `getopt` → returnType `integer | boolean | string | object | null` (socketTypes.ts; added missing `boolean` + `constantPrefixes` for completion parity with setopt). Verified `uc_socket_inst_getopt` (socket.c): the type is the option's `SV_*` class from a (level, option) lookup in `sockopts[]` — SV_INT/SV_INT_RO→integer, SV_BOOL→boolean, SV_STRING→string, SV_IFNAME→string|integer, struct classes (ucred/timeval/…)→object. Per-constant narrowing DEFERRED: requires constant-propagating BOTH args and porting the full ~200-entry two-key table with 6+ value shapes; `constantPrefixes` only drives completion, not return typing — no clean mechanism.

# Builtin Return Type Audit

Research of ALL ucode C sources to identify incorrect return types in our LSP and narrowing opportunities.

**Files researched:**
- `lib.c` — global builtins (print, sprintf, length, split, type, etc.)
- `lib/fs.c` — filesystem module
- `lib/math.c` — math module
- `lib/struct.c` — struct packing/unpacking module
- `lib/io.c` — low-level I/O module
- `lib/debug.c` — debug/introspection module
- `lib/digest.c` — hash digest module (md5, sha1, sha256, etc.)
- `lib/log.c` — syslog/ulog module
- `lib/resolv.c` — DNS resolver module
- `lib/uci.c` — UCI configuration module
- `lib/ubus.c` — ubus IPC module
- `lib/uloop.c` — event loop module
- `lib/zlib.c` — compression module
- `lib/nl80211.c` — wireless netlink module
- `lib/rtnl.c` — routing netlink module
- `lib/socket.c` — socket module

Date: 2026-04-01

---

## Key Concepts

**NULL_REASON categories:**
- `wrong_arg_type` — null returned because a C type check failed (e.g., expected string, got number). **Narrowable** at analysis time when we know arg types.
- `runtime_failure` — null returned because a syscall/OS operation failed (e.g., file not found). **Not narrowable** from arg types alone.
- `both` — null can occur from either reason.

**Narrowing**: When `nullMeansWrongType` is true, we can eliminate null from the return type if all argument types are proven correct at analysis time.

---

## lib.c — Global Builtins

### Return Types Fixed in 0.6.19

These were wrong and have been corrected:

| Function | Was | Now | Notes |
|----------|-----|-----|-------|
| `push` | `number` | `any\|null` | Returns last pushed value, NOT a count |
| `unshift` | `number` | `any\|null` | Returns last value added, NOT a count |
| `warn` | `null` | `integer` | Returns byte count written to stderr |
| `sleep` | `null` | `boolean` | Returns true on success, false on invalid duration |
| `gc` | `null` | `boolean` (default), `integer` for "count" | Value-based narrowing implemented |
| `getenv` | `string` | `object` (0 args) / `string\|null` (1 arg) | Argument-count narrowing implemented |
| `loadstring` | `any` | `function\|null` | Returns closure on success |
| `loadfile` | `any` | `function\|null` | Returns closure on success |

### Null Added + Narrowing Implemented in 0.6.19

These had missing null and now include it, with `nullMeansWrongType` narrowing:

| Function | LSP Type | NULL_REASON | Narrowing Rule |
|----------|----------|-------------|----------------|
| `length` | `integer\|null` | wrong_arg_type | arg is string/array/object -> `integer` |
| `index` | `integer\|null` | wrong_arg_type | arg1 is string/array -> `integer` |
| `rindex` | `integer\|null` | wrong_arg_type | arg1 is string/array -> `integer` |
| `join` | `string\|null` | wrong_arg_type | arg2 is array -> `string` |
| `substr` | `string\|null` | wrong_arg_type | arg1 is string -> `string` |
| `trim` | `string\|null` | wrong_arg_type | arg1 is string -> `string` |
| `ltrim` | `string\|null` | wrong_arg_type | same as trim |
| `rtrim` | `string\|null` | wrong_arg_type | same as trim |
| `replace` | `string\|null` | wrong_arg_type | all 3 args non-null -> `string` |
| `uc` | `string\|null` | wrong_arg_type | arg1 is non-null -> `string` |
| `lc` | `string\|null` | wrong_arg_type | arg1 is non-null -> `string` |
| `type` | `string\|null` | wrong_arg_type | arg1 is non-null -> `string` (type(null) returns null) |
| `uniq` | `array\|null` | wrong_arg_type | arg1 is array -> `array` |
| `b64enc` | `string\|null` | wrong_arg_type | arg1 is string -> `string` |
| `hexenc` | `string\|null` | wrong_arg_type | arg1 is non-null -> `string` |
| `wildcard` | `boolean\|null` | wrong_arg_type | arg1 non-null AND arg2 string -> `boolean` |
| `splice` | `array\|null` | wrong_arg_type | arg1 is array -> `array` |
| `split` | `array\|null` | wrong_arg_type | arg1 string + arg2 string -> `array` |
| `keys` | `array\|null` | wrong_arg_type | arg1 is object -> `array` |
| `values` | `array\|null` | wrong_arg_type | arg1 is object -> `array` |

### Null Added Without Narrowing in 0.6.19

These now correctly include null but narrowing is not possible (runtime failures):

| Function | LSP Type | NULL_REASON | Notes |
|----------|----------|-------------|-------|
| `ord` | `integer\|null` | both | Still null for out-of-range offset |
| `b64dec` | `string\|null` | both | Still null for invalid base64 |
| `hexdec` | `string\|null` | both | Still null for invalid hex |
| `sourcepath` | `string\|null` | both | Runtime-dependent (depth, realpath) |
| `iptoarr` | `array\|null` | both | Still null for invalid IP string |
| `arrtoip` | `string\|null` | both | Still null for invalid array |
| `localtime` | `object\|null` | runtime_failure | C localtime() can fail for large timestamps |
| `gmtime` | `object\|null` | runtime_failure | C gmtime() can fail |
| `timelocal` | `integer\|null` | both | mktime can return -1 |
| `timegm` | `integer\|null` | both | same as timelocal |
| `filter` | `array\|null` | both | Callback exception can cause null |
| `map` | `array\|null` | both | same as filter |
| `sort` | `array\|null` | both | Immutable or callback exception |
| `proto` | `object\|null` | wrong_arg_type | Not narrowed (2-arg form returns input type) |
| `render` | `string\|null` | runtime_failure | Allocation failure |

### Still TODO (lib.c)

| Function | Current LSP | Correct Type | Issue |
|----------|------------|--------------|-------|
| `min` | `any\|null` | `any\|null` | Returns any value type — type correct but imprecise |
| `max` | `any\|null` | `any\|null` | same |

### Fixed in 0.6.19-0.6.21 (lib.c)

| Function | Was | Now | Notes |
|----------|-----|-----|-------|
| `slice` | `unknown` | `array\|null` (narrowable) | nullMeansWrongType, narrowingArgs: [0] |
| `sort` | `array\|null` | `array\|object\|null` | Validator handles both array and object input |
| `signal` | `unknown` | `function\|string\|null` | Arg2-type narrowing (function→function\|null, etc.) |
| `proto` | `object\|null` | `object\|null` | 2-arg form narrows: returns first arg type |
| `trace` | `null` | `integer\|null` | Correct return type |

### Functions With Correct Return Types (were already correct or never-null)

| Function | Type | Notes |
|----------|------|-------|
| `print` | `number` | Always returns byte count |
| `printf` | `number` | Always returns byte count |
| `sprintf` | `string` | Always returns string |
| `length` | `number\|null` | Narrowable: arg is string/array/object -> never null |
| `split` | `array\|null` | Narrowable: arg1 string + arg2 string/regexp -> never null |
| `chr` | `string` | Always returns string (empty for 0 args) |
| `keys` | `array\|null` | Narrowable: arg1 is object -> never null |
| `values` | `array\|null` | Narrowable: arg1 is object -> never null |
| `pop` | `any\|null` | null for non-array OR empty array (both reasons) |
| `shift` | `any\|null` | same as pop |
| `filter` | `array\|null` | PARTIAL narrow: arg1 array eliminates wrong-type null, callback exception null remains |
| `map` | `array\|null` | same as filter |
| `match` | `array\|null` | both: wrong pattern type + no match found |
| `time` | `number` | Always returns integer |
| `int` | `number` | Never null (returns NaN for bad input) |
| `hex` | `number` | Never null (returns NaN for bad input) |
| `uchr` | `string` | Always returns string |
| `die` | `never` | Always throws |
| `exit` | `never` | Always throws |
| `exists` | `boolean` | Always returns boolean (false, not null, for non-objects) |
| `clock` | `array\|null` | runtime_failure only |
| `gc` | `boolean\|number\|null` | Complex, depends on operation string |
| `assert` | `any` | Returns input if truthy, throws if falsy |
| `regexp` | `regexp` | Throws on bad input rather than returning null |
| `call` | `any\|null` | Not narrowable |
| `render` | `string\|null` | runtime_failure only (allocation) |
| `json` | `any` | Throws on parse error |
| `include` | `null` | Always returns null (side-effect only) |
| `require` | `any` | Throws on failure |

### Narrowing Candidates — All Implemented in 0.6.19

All 17 `nullMeansWrongType` narrowing candidates plus `type()`, `getenv()`, and `gc()` are now implemented. See "Null Added + Narrowing Implemented" table above for the full list.

---

## lib/fs.c — FS Module

### Functions Where Current LSP Return Type is WRONG

| Function | Current LSP | Correct Type | Issue |
|----------|------------|--------------|-------|
| `writefile` | `boolean` | `integer\|null` | Returns byte count, not boolean! |
| `mkdir` | `boolean` | `boolean\|null` | Missing null (true-only, never false) |
| `rmdir` | `boolean` | `boolean\|null` | Missing null (true-only, never false) |
| `unlink` | `boolean` | `boolean\|null` | Missing null (true-only, never false) |
| `access` | `boolean` | `boolean\|null` | Missing null (true-only, never false). Also: mode param is `string` not `number` |
| `dirname` | `string` | `string\|null` | Missing null (wrong_arg_type only, narrowable) |
| `basename` | `string` | `string\|null` | Missing null (wrong_arg_type only, narrowable) |

### Parameter Type Errors in fsModuleTypes.ts

| Function | Parameter | Current | Correct |
|----------|-----------|---------|---------|
| `access` | mode | `number` | `string` ("r", "w", "x", "f") |
| `chown` | uid/gid | `number` | `number\|string\|null` (accepts username/groupname strings, null = don't change) |
| `chdir` | path | `string` | `string\|integer` (also accepts fd) |
| `lsdir` | pattern | (missing) | optional `string\|regexp` second param |
| `readfile` | limit | (missing) | optional `integer` second param |

### Duplicate Entries in fsModuleTypes.ts Map

These appear twice (last entry wins in Map):
- `symlink` — first: `boolean`, second: `boolean | null`
- `rename` — first: `boolean`, second: `boolean | null`
- `chdir` — first: `boolean`, second: `boolean | null`
- `getcwd` — duplicated with same type
- `glob` — duplicated with same type

### Element Type Opportunities

| Function | Current | Could Be |
|----------|---------|----------|
| `glob` | `array` | `array<string>` |
| `lsdir` | `array` | `array<string>` |
| `pipe` | `array` | `array<fs.file>` |

### Narrowable fs Functions

| Function | Narrowing Rule |
|----------|---------------|
| `glob` | All args are strings -> `array` (never null). Already has `nullMeansWrongType: true` |
| `dirname` | arg1 is string -> `string` (never null) |
| `basename` | arg1 is string -> `string` (never null) |

### fs Object Method Return Types

Most fs.file / fs.dir / fs.proc methods can return null due to invalid handle or syscall failure (runtime).
These are generally NOT narrowable from argument types. Key notes:

- `fs.file.isatty` — can return true OR false (most others are true-only)
- `fs.proc.close` — returns `integer | null` (exit code), NOT boolean
- `fs.file.write` / `fs.proc.write` — returns `integer | null` (byte count)

---

## lib/math.c — Math Module

The math module is exceptionally clean. **No narrowing needed.**

| Function | Return Type | Notes |
|----------|------------|-------|
| `math.abs` | `number` | integer or double, never null |
| `math.atan2` | `double` | never null |
| `math.cos` | `double` | never null |
| `math.exp` | `double` | never null |
| `math.log` | `double` | never null |
| `math.sin` | `double` | never null |
| `math.sqrt` | `double` | never null |
| `math.pow` | `double` | never null |
| `math.rand` | `integer \| double` | 0 args: integer, 1+ args: double. Never null. Honest union (per-arg-count narrowing deferred) |
| `math.srand` | `null` | void function, always null |
| `math.isnan` | `boolean` | never null |

---

## lib/struct.c — Struct Module

| Function | Return Type | NULL_REASON | Notes |
|----------|------------|-------------|-------|
| `struct.pack` | `string \| null` | wrong_arg_type | null paths raise exceptions, so effectively: string or throws |
| `struct.unpack` | `array \| null` | both | silent null when buffer too short |
| `struct.new` | `resource \| null` | wrong_arg_type | null raises exception; effectively: resource or throws |
| `struct.buffer` | `resource` | n/a | always returns resource |

Buffer methods mostly return `resource` (self for chaining) or null on context errors.
Not practically narrowable by LSP.

---

## lib/io.c — IO Module

### Top-level Functions

| Function | Return Type | NULL_REASON | Narrowable? |
|----------|------------|-------------|-------------|
| `io.error` | `string \| null` | n/a (null = no error) | NO |
| `io.new` | `io.handle \| null` | wrong_arg_type + runtime | PARTIAL |
| `io.open` | `io.handle \| null` | both | PARTIAL (type-narrow only) |
| `io.from` | `io.handle \| null` | both | NO (flexible arg type) |
| `io.pipe` | `array \| null` | runtime_failure | NO |

### io.handle Methods

Nearly all methods can return null due to invalid handle (runtime).
Most boolean returns are true-only (never false), except:
- `io.handle.isatty` — returns true or false

Key return type notes:
- `io.handle.read` — `string | null` (empty string on EOF, not null)
- `io.handle.write` — `integer | null` (byte count)
- `io.handle.fileno` — `integer | null`
- `io.handle.tell` — `integer | null`
- `io.handle.fcntl` — `integer | io.handle | null` (F_DUPFD returns new handle)
- `io.handle.ioctl` — `string | integer | null` (depends on direction)
- `io.handle.tcgetattr` — `object | null` (with iflag, oflag, cflag, lflag, ispeed, ospeed, cc properties)
- `io.handle.ptsname` — `string | null`

---

## Implementation Status

### Done (0.6.19)
- [x] Phase 1: Fix wrong return types (push, unshift, warn, sleep, gc, getenv, loadstring, loadfile)
- [x] Phase 2: Add missing null to 30+ builtin return types
- [x] Phase 3: Argument-type narrowing via `nullMeansWrongType` (17 builtins)
- [x] Argument-count narrowing: `getenv()` (0 args → object)
- [x] Value-based narrowing: `gc()` ("count" → integer, etc.)
- [x] Signal narrowing: function/string/null based on arg2 type
- [x] Sort: accepts objects, returns object|null for object input
- [x] Slice: array|null with nullMeansWrongType narrowing
- [x] Trace: integer|null return type

### Done (0.6.20)
- [x] fs module: writefile → integer|null, mkdir/rmdir/unlink/access → boolean|null
- [x] fs module: access mode param string not number, dirname/basename nullMeansWrongType
- [x] fs module: removed 5 duplicate Map entries

### Done (0.6.21)
- [x] glob/lsdir element types: `array<string>` with `array<T>` parsing in parseSingleType
- [x] proto 2-arg narrowing: returns first arg type (object for object, null for wrong type)

### Done (0.6.22)
- [x] ubus: connect → object|null, open_channel → object|null, guard → function|boolean|null
- [x] debug: traceback → StackTraceEntry[]|null
- [x] resolv: query → object|null
- [x] struct: pack → string|null, unpack → array|null, new → struct.instance|null, buffer → struct.buffer|null
- [x] rtnl: request → object|array|boolean|null, listener → rtnl.listener|null
- [x] nl80211: request → object|array|boolean|null, listener → nl80211.listener|null
- [x] sort: wrong-type args now correctly narrow to null

### Done (0.6.24)
- [x] fs: chown uid/gid → `number | string | null` (accepts usernames/group names and null)
- [x] fs: readfile optional `size` (integer) parameter added
- [x] fs: pipe → `array<fs.file> | null` element type
- [x] socket: pair() added (returns `array | null`)
- [x] socket: open() added (wraps fd, returns `socket | null`)

### Remaining TODO

**Future: Value-based narrowing:**
- `ord(str, offset)` — offset within string length
- `b64dec(str)` — valid base64 content
- `iptoarr(str)` — valid IP format
- ~~`math.rand()` — 0 args returns integer, 1+ args returns double~~ — resolved as honest union `integer | double` (batch L2); precise arg-count narrowing deferred, see header note.
- ~~`socket.getopt()` — return type depends on option constant (constant propagation)~~ — resolved as honest union `integer | boolean | string | object | null` (batch L2); per-constant narrowing deferred, see header note.

---

## lib/debug.c — Debug Module

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `debug.memdump` | `boolean \| null` | both | PARTIAL | Returns true on success. Null if arg is wrong type or fopen fails (string path). Resource args (fs.file/fs.proc) avoid fopen failure. |
| `debug.traceback` | `array \| null` | wrong_arg_type | YES | No args or valid integer -> always returns array (possibly empty). Null only if level arg is non-integer. |
| `debug.sourcepos` | `object \| null` | runtime_failure | NO | No args. Null if callframes < 2 or caller is C function. Returns `{filename, line, byte}`. |
| `debug.getinfo` | `object \| null` | wrong_arg_type | YES | Any non-null arg -> always returns object `{type, value, tagged, ...}`. Null only for null/missing arg. |
| `debug.getlocal` | `object \| null` | both | PARTIAL | Null from invalid level, C frames, var not found. Returns `{index, name, value, linefrom, bytefrom, lineto, byteto}`. |
| `debug.setlocal` | `object \| null` | both | PARTIAL | Same as getlocal (shared uc_xlocal implementation). |
| `debug.getupval` | `object \| null` | both | PARTIAL | Null from bad depth, no closure, var not found. Returns `{index, name, closed, value}`. |
| `debug.setupval` | `object \| null` | both | PARTIAL | Same as getupval (shared uc_xupval implementation). |

---

## lib/digest.c — Digest Module

All hash functions follow the same pattern. In-memory variants practically never fail with correct arg types.

### In-memory hash functions (arg is string -> practically always returns string)

| Function | Return Type | NULL_REASON | Narrowable? |
|----------|------------|-------------|-------------|
| `digest.md5` | `string \| null` | wrong_arg_type | YES (arg is string -> string) |
| `digest.sha1` | `string \| null` | wrong_arg_type | YES |
| `digest.sha256` | `string \| null` | wrong_arg_type | YES |
| `digest.md2` | `string \| null` | wrong_arg_type | YES (HAVE_DIGEST_EXTENDED) |
| `digest.md4` | `string \| null` | wrong_arg_type | YES (HAVE_DIGEST_EXTENDED) |
| `digest.sha384` | `string \| null` | wrong_arg_type | YES (HAVE_DIGEST_EXTENDED) |
| `digest.sha512` | `string \| null` | wrong_arg_type | YES (HAVE_DIGEST_EXTENDED) |

### File-based hash functions (always retain null — file I/O can fail)

| Function | Return Type | NULL_REASON | Narrowable? |
|----------|------------|-------------|-------------|
| `digest.md5_file` | `string \| null` | both | PARTIAL (arg string eliminates type null, runtime remains) |
| `digest.sha1_file` | `string \| null` | both | PARTIAL |
| `digest.sha256_file` | `string \| null` | both | PARTIAL |
| `digest.md2_file` | `string \| null` | both | PARTIAL (HAVE_DIGEST_EXTENDED) |
| `digest.md4_file` | `string \| null` | both | PARTIAL |
| `digest.sha384_file` | `string \| null` | both | PARTIAL (HAVE_DIGEST_EXTENDED) |
| `digest.sha512_file` | `string \| null` | both | PARTIAL (HAVE_DIGEST_EXTENDED) |

---

## lib/log.c — Log Module

Exceptionally clean. No function returns null conditionally (except void-like closelog/ulog_close).

| Function | Return Type | Notes |
|----------|------------|-------|
| `log.openlog` | `boolean` | true on success, false on invalid args. Never null. |
| `log.syslog` | `boolean` | true on success, false on bad priority/args. Never null. |
| `log.closelog` | `null` | Void function, always null. |
| `log.ulog_open` | `boolean` | OpenWrt-only. Never null. |
| `log.ulog` | `boolean` | OpenWrt-only. Never null. |
| `log.ulog_close` | `null` | OpenWrt-only. Void, always null. |
| `log.ulog_threshold` | `boolean` | OpenWrt-only. Never null. |
| `log.INFO` | `boolean` | OpenWrt-only. Never null. |
| `log.NOTE` | `boolean` | OpenWrt-only. Never null. |
| `log.WARN` | `boolean` | OpenWrt-only. Never null. |
| `log.ERR` | `boolean` | OpenWrt-only. Never null. |

**Exported constants:** LOG_PID, LOG_CONS, LOG_NDELAY, LOG_ODELAY, LOG_NOWAIT (options); LOG_AUTH through LOG_LOCAL7 (facilities); LOG_EMERG through LOG_DEBUG (priorities); ULOG_KMSG, ULOG_SYSLOG, ULOG_STDIO (OpenWrt channels).

---

## lib/resolv.c — DNS Resolver Module

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `resolv.query` | `object \| null` | both | PARTIAL | Null from wrong arg types in names/options sub-fields. Once past validation, always returns object (DNS errors encoded as rcode properties, not as null). |
| `resolv.error` | `string \| null` | n/a (null = no error) | NO | No arguments. |

---

## lib/uci.c — UCI Configuration Module

### Global Functions

| Function | Return Type | NULL_REASON | Narrowable? |
|----------|------------|-------------|-------------|
| `uci.error` | `string \| null` | n/a (null = no error) | NO |
| `uci.cursor` | `uci.cursor \| null` | both | PARTIAL (string args eliminate type null, alloc/path can still fail) |

### uci.cursor Methods

Most cursor methods follow the `boolean(true) | null` pattern via ok_return/err_return.

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `cursor.load` | `true \| null` | both | PARTIAL | arg is string eliminates type null |
| `cursor.unload` | `boolean \| null` | wrong_arg_type | YES | true if found, false if not loaded. No runtime failure once validated. |
| `cursor.get` | `string \| array<string> \| null` | both | PARTIAL | Returns string (section type) or string/array (option value). Null from not-found is runtime. |
| `cursor.get_all` | `object \| null` | both | PARTIAL | Returns section object or whole config object. |
| `cursor.get_first` | `string \| array<string> \| null` | both | PARTIAL | Like get but finds first section of given type. |
| `cursor.add` | `string \| null` | both | PARTIAL | Returns auto-generated section name. |
| `cursor.set` | `true \| null` | both | PARTIAL | Complex arg validation (3 or 4 args). |
| `cursor.rename` | `true \| null` | both | PARTIAL | 3 or 4 string args. |
| `cursor.save` | `true \| null` | both | PARTIAL | Optional string config arg. |
| `cursor.delete` | `true \| null` | both | PARTIAL | 2 or 3 string args. |
| `cursor.list_append` | `true \| null` | both | PARTIAL | |
| `cursor.list_remove` | `true \| null` | both | PARTIAL | |
| `cursor.commit` | `true \| null` | both | PARTIAL | |
| `cursor.revert` | `true \| null` | both | PARTIAL | |
| `cursor.reorder` | `true \| null` | both | PARTIAL | |
| `cursor.changes` | `object \| null` | both | PARTIAL | Returns `Object<string, ChangeRecord[]>`. |
| `cursor.foreach` | `boolean \| null` | both | PARTIAL | true if callback invoked, false if no matching sections. |
| `cursor.configs` | `array<string> \| null` | runtime_failure | NO | No args to narrow on. |

---

## lib/ubus.c — Ubus IPC Module

### Global Functions

| Function | Return Type | NULL_REASON | Narrowable? |
|----------|------------|-------------|-------------|
| `ubus.error` | `string \| integer \| null` | n/a (null = no error) | NO |
| `ubus.connect` | `ubus.connection \| null` | both | PARTIAL |
| `ubus.open_channel` | `ubus.channel \| null` | both | PARTIAL (HAVE_UBUS_CHANNEL_SUPPORT) |
| `ubus.guard` | `function \| true \| null` | wrong_arg_type | PARTIAL |

### ubus.connection Methods

| Function | Return Type | NULL_REASON | Narrowable? |
|----------|------------|-------------|-------------|
| `connection.list` | `array \| null` | both | PARTIAL |
| `connection.call` | `object \| array \| null` | both | PARTIAL. Return shape depends on `return` mode. |
| `connection.defer` | `ubus.deferred \| null` | both | PARTIAL |
| `connection.publish` | `ubus.object \| null` | both | PARTIAL |
| `connection.remove` | `true \| null` | both | NO |
| `connection.listener` | `ubus.listener \| null` | both | PARTIAL |
| `connection.subscriber` | `ubus.subscriber \| null` | both | PARTIAL |
| `connection.event` | `true \| null` | both | PARTIAL |
| `connection.error` | `string \| integer \| null` | n/a (shared with ubus.error) | NO |
| `connection.disconnect` | `true \| null` | runtime_failure | NO |

### ubus.deferred Methods

| Function | Return Type | NULL_REASON | Notes |
|----------|------------|-------------|-------|
| `deferred.await` | `boolean \| null` | wrong_arg_type (invalid this) | false if complete, true after awaiting |
| `deferred.completed` | `boolean \| null` | wrong_arg_type (invalid this) | |
| `deferred.abort` | `boolean \| null` | wrong_arg_type (invalid this) | false if already complete |

### ubus.object Methods

| Function | Return Type | NULL_REASON |
|----------|------------|-------------|
| `object.subscribed` | `boolean \| null` | wrong_arg_type (invalid this) |
| `object.notify` | `ubus.notify \| integer \| null` | both. Resource if async (timeout<0), integer if sync. |
| `object.remove` | `true \| null` | both |

### ubus.request Methods

| Function | Return Type | NULL_REASON |
|----------|------------|-------------|
| `request.reply` | `true \| null` | both (already-replied, invalid context) |
| `request.error` | `true \| null` | both |
| `request.defer` | `true \| null` | wrong_arg_type (invalid this) |
| `request.get_fd` | `integer \| null` | wrong_arg_type (invalid this) |
| `request.set_fd` | `true \| null` | both |
| `request.new_channel` | `ubus.channel \| null` | both (HAVE_UBUS_CHANNEL_SUPPORT) |

### Other ubus resource methods

| Function | Return Type | Notes |
|----------|------------|-------|
| `notify.completed` | `boolean` | Never null |
| `notify.abort` | `boolean` | Never null |
| `listener.remove` | `true \| null` | runtime |
| `subscriber.subscribe` | `true \| null` | both |
| `subscriber.unsubscribe` | `true \| null` | both |
| `subscriber.remove` | `true \| null` | both |

---

## lib/uloop.c — Event Loop Module

### Global Functions

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `uloop.error` | `string \| null` | n/a (null = no error) | NO | |
| `uloop.init` | `boolean \| null` | runtime_failure | NO | No args. |
| `uloop.run` | `integer \| null` | runtime_failure | NO | Returns signal number or 0. |
| `uloop.timer` | `uloop.timer \| null` | both | PARTIAL | int timeout + function callback |
| `uloop.handle` | `uloop.handle \| null` | both | PARTIAL | fd + function + flags |
| `uloop.process` | `uloop.process \| null` | both | PARTIAL | string exec + array args + object env + function cb |
| `uloop.task` | `uloop.task \| null` | both | PARTIAL | function + optional callbacks |
| `uloop.cancelling` | `boolean` | n/a | - | Never null |
| `uloop.running` | `boolean` | n/a | - | Never null |
| `uloop.done` | `null` | n/a | - | Void function |
| `uloop.end` | `null` | n/a | - | Void function |
| `uloop.interval` | `uloop.interval \| null` | wrong_arg_type | YES | HAVE_ULOOP_INTERVAL |
| `uloop.signal` | `uloop.signal \| null` | wrong_arg_type | YES | HAVE_ULOOP_SIGNAL |
| `uloop.guard` | `function \| true \| null` | wrong_arg_type | PARTIAL | Getter/setter pattern |

### uloop resource methods

Most methods return `boolean | null` or `integer | null`, with null only from invalid `this` context (effectively unreachable in well-typed code). Not individually listed — pattern is consistent.

Key methods:
- `timer.set/remaining/cancel`, `handle.fileno/handle/delete`, `process.pid/delete`
- `task.pid/kill/finished`, `pipe.send/receive/sending/receiving`
- `interval.set/remaining/expirations/cancel`, `signal.signo/delete`

---

## lib/zlib.c — Compression Module

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `zlib.deflate` | `string \| null` | both | NO | Throws on type errors. Null only from compression failure. Effectively: string or throws. |
| `zlib.inflate` | `string \| null` | both | NO | Throws on type errors. Null only from decompression failure. |
| `zlib.deflater` | `zlib.deflate \| null` | both | PARTIAL | Null from calloc OOM or deflateInit2 failure. |
| `zlib.inflater` | `zlib.inflate \| null` | runtime_failure | NO | No meaningful args. |

### Stream methods

| Function | Return Type | Notes |
|----------|------------|-------|
| `deflate.write` / `inflate.write` | `boolean \| null` | Null from invalid stream state |
| `deflate.read` / `inflate.read` | `string \| null` | Null from invalid stream or no data |
| `deflate.error` / `inflate.error` | `string \| null` | null = no error |

---

## lib/nl80211.c — Wireless Netlink Module

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `nl80211.error` | `string \| null` | n/a (null = no error) | NO | |
| `nl80211.request` | `object \| array \| boolean \| null` | both | PARTIAL | object/array from reply, true from unreplied, false from error |
| `nl80211.waitfor` | `object \| null` | both | PARTIAL | Returns `{cmd, msg}` on event, null on timeout/error |
| `nl80211.listener` | `nl80211.listener \| null` | both | PARTIAL | |

### nl80211.listener methods

| Function | Return Type | Notes |
|----------|------------|-------|
| `listener.set_commands` | `null` | Void function |
| `listener.request` | `object \| array \| boolean \| null` | Same as nl80211.request |
| `listener.close` | `null` | Void function |

---

## lib/rtnl.c — Routing Netlink Module

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `rtnl.error` | `string \| null` | n/a (null = no error) | NO | |
| `rtnl.request` | `object \| array \| boolean \| null` | both | PARTIAL | Same pattern as nl80211.request |
| `rtnl.listener` | `rtnl.listener \| null` | both | PARTIAL | Has extra `groups` param vs nl80211 |

### rtnl.listener methods

| Function | Return Type | Notes |
|----------|------------|-------|
| `listener.set_commands` | `null` | Void function |
| `listener.close` | `null` | Void function |

Note: rtnl lacks `waitfor` and `listener.request` (unlike nl80211).

---

## lib/socket.c — Socket Module

### Global Functions

| Function | Return Type | NULL_REASON | Narrowable? | Notes |
|----------|------------|-------------|-------------|-------|
| `socket.sockaddr` | `object \| null` | both | NO | Flexible arg types |
| `socket.create` | `socket \| null` | runtime_failure | NO | socket() syscall can fail |
| `socket.pair` | `array<socket> \| null` | runtime_failure | NO | socketpair() can fail |
| `socket.open` | `socket \| null` | wrong_arg_type | YES | fd is integer -> always returns socket |
| `socket.nameinfo` | `object \| null` | both | NO | `{hostname, service}` |
| `socket.addrinfo` | `array \| null` | both | PARTIAL | hostname is string eliminates type null |
| `socket.poll` | `array \| null` | both | PARTIAL | Returns `[socket, flags]` tuples |
| `socket.connect` | `socket \| null` | both | NO | High-level, many failure paths |
| `socket.listen` | `socket \| null` | both | NO | High-level, many failure paths |
| `socket.error` | `string \| integer \| null` | n/a (null = no error) | PARTIAL | truthy arg -> integer, falsy -> string |
| `socket.strerror` | `string \| null` | wrong_arg_type | YES | arg is integer -> always returns string |

### socket instance methods

Most methods return `true | null` or value `| null`, with null from invalid socket context or syscall failure. Not practically narrowable.

| Function | Return Type | Notes |
|----------|------------|-------|
| `socket.connect` | `true \| null` | Instance method, not global |
| `socket.bind` | `true \| null` | |
| `socket.listen` | `true \| null` | |
| `socket.accept` | `socket \| null` | |
| `socket.send` | `integer \| null` | Byte count |
| `socket.sendmsg` | `integer \| null` | Byte count |
| `socket.recv` | `string \| null` | Empty string on connection close |
| `socket.recvmsg` | `object \| null` | `{flags, length, address?, data, ancillary?}` |
| `socket.setopt` | `true \| null` | |
| `socket.getopt` | `integer \| boolean \| string \| object \| null` | Type depends on option queried |
| `socket.fileno` | `integer \| null` | |
| `socket.shutdown` | `true \| null` | |
| `socket.peercred` | `object \| null` | `{uid, gid, pid}` |
| `socket.peername` | `object \| null` | SocketAddress |
| `socket.sockname` | `object \| null` | SocketAddress |
| `socket.close` | `true \| null` | |
| `socket.error` | `string \| integer \| null` | Shared with global |

---

## Cross-Module Patterns

### Common `error()` function pattern
Every module with an `error()` function follows the same pattern: returns `string | null` where null means "no error has occurred". This is intentional — null is not a failure. Modules: fs, io, uci, ubus, uloop, zlib, nl80211, rtnl, socket, resolv.

Some modules (ubus, socket) also accept a truthy arg to return the error code as integer instead of the message string.

### `true | null` pattern (never returns false)
Many C module functions only return `true` or `null`, never `false`. The LSP types these as `boolean | null` but the "boolean" is always true. This applies to: most uci cursor mutation methods, ubus connection methods, uloop resource methods, fs mkdir/rmdir/unlink/access, socket instance methods.

### Void functions (always return null)
These intentionally return null: `log.closelog`, `log.ulog_close`, `uloop.done`, `uloop.end`, `nl80211.listener.set_commands`, `nl80211.listener.close`, `rtnl.listener.set_commands`, `rtnl.listener.close`.
