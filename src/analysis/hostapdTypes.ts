/**
 * The `hostapd` and `wpas` (wpa_supplicant) ambient globals injected into OpenWrt hostapd /
 * wpa_supplicant ucode scripts. The daemon embeds libucode and binds the global into the VM scope
 * BEFORE the script runs — `wpa_ucode_global_init()` does
 * `ucv_object_add(uc_vm_scope_get(&vm), "hostapd"/"wpas", global)` (utils/ucode.c) — so the name is
 * a live C-backed resource from line 1. Scripts live at `/usr/share/hostap/*.uc`.
 *
 * On the OpenWrt corpus these are the single biggest false-positive source (hostapd 132 + wpas 97
 * UC1001). Seeded ONLY in a matching hostapd/wpas script (usage of `hostapd.<member>` / `wpas.<member>`
 * or the `/usr/share/hostap/` path) — a non-hostapd file referencing `hostapd` still gets UC1001.
 * See SemanticAnalyzer.detectAndDeclareHostapd.
 *
 * All signatures + nullability are from the vendored C (hostapd/src/{src/ap,wpa_supplicant,src/utils}
 * /ucode.c, PKG_SOURCE_DATE 2026-04-02). Return-type convention: a C impl returning NULL = ucode
 * `null`. Non-method members (`data`, `interfaces`, `bss`, `MSG_*`) live on the resource prototype
 * and are carried as zero-arg members typed to their value, mirroring the netifd/uhttpd ambients.
 *
 * The two globals are `openMembers` (like netifd's daemon shape): the scripts extend them at runtime
 * (`hostapd.ubus = …` / `wpas.ubus = …`), so an unknown member resolves to `unknown`, not UC5004.
 * The `.bss`/`.iface` handle types are pure C resources → strict (an unknown member is a typo).
 *
 * VERSION FACTS — verified by introspecting the live daemon across the OpenWrt release containers
 * (install hostapd, replace hostapd.uc with a probe, run `hostapd -g`):
 *   • FLOOR = 23.05. 22.03 has hostapd but NO ucode integration (no /usr/share/hostap/*.uc, no
 *     `hostapd.global` symbol in the binary). 23.05 is the first release with the `hostapd`/`wpas`
 *     globals. (This is the gate in SemanticAnalyzer.detectAndDeclareHostapd.)
 *   • `udebug_set` was ADDED in 24.10 — ABSENT (null) in 23.05, a function from 24.10 on. Also the
 *     shared `wpas.udebug_set`. Both carry `introducedIn: '24.10'`, so on a 23.05 target the base
 *     global still resolves but a `udebug_set` usage flags UC6005 (per-member gating in
 *     detectAndDeclareHostapd — 23.05-era members stay clean).
 *   • `rkh_derive_key` is BUILD-dependent (CONFIG_IEEE80211R_AP), not a version gate: null in the
 *     plain `hostapd` builds (23.05/24.10 tested), a function in `-basic-mbedtls` (25.12/main). Like
 *     the DPP methods — typed optimistically for full builds.
 *   • `interfaces`/`bss` are `object | null` (NULL until an interface/BSS is added — verified live).
 *   • The member set is otherwise identical across 23.05→main; main == this vendored source.
 */
import type { FunctionSignature } from './moduleTypes';
import type { ObjectTypeDefinition } from './registryFactory';

const arg = (name: string, type: string, optional = false): FunctionSignature['parameters'][number] =>
  ({ name, type, optional });

// ── shared value-members: `data` scratch object, the interface maps, MSG_* log constants ──────
const msgConsts = (): Array<[string, FunctionSignature]> =>
  ([['MSG_EXCESSIVE', 0], ['MSG_MSGDUMP', 1], ['MSG_DEBUG', 2], ['MSG_INFO', 3], ['MSG_WARNING', 4], ['MSG_ERROR', 5]] as const)
    .map(([name, v]) => [name, { name, parameters: [], returnType: 'integer',
      description: `Log-level constant (= ${v}), for \`printf(level, …)\`.` }]);

// ── hostapd.global ────────────────────────────────────────────────────────────
const hostapdGlobalMethods = new Map<string, FunctionSignature>([
  ['printf', { name: 'printf', parameters: [arg('level', 'integer', true), arg('format', 'string')], returnType: 'null',
    description: 'sprintf-style log message via wpa_printf. Optional first `level` arg is an `MSG_*` constant; the rest are printf-style. Returns null.' }],
  ['getpid', { name: 'getpid', parameters: [], returnType: 'integer',
    description: 'The hostapd process PID.' }],
  ['sha1', { name: 'sha1', parameters: [arg('data', 'string')], returnType: 'string | null',
    description: 'SHA-1 of the concatenated string arguments as a 40-char hex string. Null on 0 args, a non-string arg, or hash failure.' }],
  ['rkh_derive_key', { name: 'rkh_derive_key', parameters: [arg('hexkey', 'string')], returnType: 'string | null',
    description: 'FT R0KH/R1KH key derivation (802.11r). Null on a non-string/invalid key — and always null unless hostapd was built with CONFIG_IEEE80211R_AP.' }],
  ['freq_info', { name: 'freq_info', parameters: [arg('freq', 'integer'), arg('sec_channel', 'integer', true), arg('width', 'integer')], returnType: 'object | null',
    description: 'Resolve a frequency to `{ op_class, channel, hw_mode, hw_mode_str, sec_channel, frequency, … }`. Null on an invalid freq/width/hw_mode.' }],
  ['add_iface', { name: 'add_iface', parameters: [arg('config', 'string')], returnType: 'integer',
    description: 'Add a hostapd interface from a config string. Returns a result code (-1 on failure / non-string arg).' }],
  ['remove_iface', { name: 'remove_iface', parameters: [arg('name', 'string')], returnType: 'null',
    description: 'Remove the named hostapd interface. Returns null.' }],
  ['udebug_set', { name: 'udebug_set', parameters: [arg('name', 'string'), arg('ubus', 'object')], returnType: 'boolean', introducedIn: '24.10',
    description: 'Wire up udebug ring-buffer logging over the given ubus connection. Returns true. Added in OpenWrt 24.10 (absent in 23.05 — verified on the daemon).' }],
  // value-members (prototype properties)
  ['data', { name: 'data', parameters: [], returnType: 'object',
    description: 'Mutable scratch object shared across the script (empty initially).' }],
  ['interfaces', { name: 'interfaces', parameters: [], returnType: 'object | null',
    description: 'Map of `phy` name → `hostapd.iface`. NULL until an interface is added (verified on the running daemon).' }],
  ['bss', { name: 'bss', parameters: [], returnType: 'object | null',
    description: 'Nested map `phy → { ifname → hostapd.bss }`. NULL until a BSS is added (verified on the running daemon).' }],
  ...msgConsts(),
]);

// ── hostapd.bss (C resource) ──────────────────────────────────────────────────
const hostapdBssMethods = new Map<string, FunctionSignature>([
  ['ctrl', { name: 'ctrl', parameters: [arg('cmd', 'string')], returnType: 'string | null',
    description: 'Send a control-interface command to this BSS; returns the reply string, or null on error / non-string arg.' }],
  ['set_config', { name: 'set_config', parameters: [arg('file', 'string'), arg('index', 'integer', true), arg('files_only', 'boolean', true)], returnType: 'integer',
    description: 'Load BSS config from a file. Returns a result code (-1 on failure).' }],
  ['rename', { name: 'rename', parameters: [arg('ifname', 'string'), arg('skip_rename', 'boolean', true)], returnType: 'boolean | null',
    description: 'Rename the BSS interface. True on success; null on failure / non-string arg.' }],
  ['delete', { name: 'delete', parameters: [], returnType: 'null',
    description: 'Delete this BSS. Returns null.' }],
  ['dpp_send_action', { name: 'dpp_send_action', parameters: [arg('dst', 'string'), arg('freq', 'integer'), arg('frame', 'string')], returnType: 'boolean | null',
    description: 'Send a DPP action frame (build-dependent: CONFIG_DPP). Null on bad args.' }],
  ['dpp_send_gas_resp', { name: 'dpp_send_gas_resp', parameters: [arg('dst', 'string'), arg('token', 'integer'), arg('data', 'string'), arg('freq', 'integer', true)], returnType: 'boolean | null',
    description: 'Send a DPP GAS response frame (build-dependent: CONFIG_DPP). Null on bad args.' }],
]);

// ── hostapd.iface (C resource) ────────────────────────────────────────────────
const hostapdIfaceMethods = new Map<string, FunctionSignature>([
  ['state', { name: 'state', parameters: [], returnType: 'string | null',
    description: 'Interface state string (e.g. "ENABLED"/"DISABLED"/"DFS"/…), or null if the iface is gone.' }],
  ['set_bss_order', { name: 'set_bss_order', parameters: [arg('bss_list', 'array')], returnType: 'boolean | null',
    description: 'Reorder the BSSes on this iface. True on success; null on failure / bad array.' }],
  ['add_bss', { name: 'add_bss', parameters: [arg('file', 'string'), arg('index', 'integer', true)], returnType: 'hostapd.bss | null',
    description: 'Add a BSS from a config file, returning the new `hostapd.bss` handle, or null on failure.' }],
  ['stop', { name: 'stop', parameters: [], returnType: 'null',
    description: 'Stop this interface. Returns null.' }],
  ['start', { name: 'start', parameters: [arg('info', 'object', true)], returnType: 'boolean | null',
    description: 'Start this interface (optional channel `info` object). True on success; null if the iface is gone or info is non-object.' }],
  ['switch_channel', { name: 'switch_channel', parameters: [arg('info', 'object')], returnType: 'boolean | null',
    description: 'Perform a CSA channel switch using the `info` object. True on success; null on error / non-object.' }],
]);

// ── wpas.global ───────────────────────────────────────────────────────────────
const wpasGlobalMethods = new Map<string, FunctionSignature>([
  ['printf', { name: 'printf', parameters: [arg('level', 'integer', true), arg('format', 'string')], returnType: 'null',
    description: 'sprintf-style log message via wpa_printf. Optional first `level` is an `MSG_*` constant. Returns null.' }],
  ['getpid', { name: 'getpid', parameters: [], returnType: 'integer',
    description: 'The wpa_supplicant process PID.' }],
  ['add_iface', { name: 'add_iface', parameters: [arg('info', 'object')], returnType: 'integer',
    description: 'Add an interface from an `info` object ({ iface, config, driver?, bridge?, ctrl? }). Returns 0 on success, -1 on failure.' }],
  ['remove_iface', { name: 'remove_iface', parameters: [arg('ifname', 'string')], returnType: 'integer',
    description: 'Remove the named interface. Returns a result code (-1 on failure).' }],
  ['udebug_set', { name: 'udebug_set', parameters: [arg('name', 'string'), arg('ubus', 'object')], returnType: 'boolean', introducedIn: '24.10',
    description: 'Wire up udebug ring-buffer logging over the given ubus connection. Returns true. Added in OpenWrt 24.10 (absent in 23.05 — verified on the daemon).' }],
  // value-members
  ['data', { name: 'data', parameters: [], returnType: 'object',
    description: 'Mutable scratch object shared across the script (empty initially).' }],
  ['interfaces', { name: 'interfaces', parameters: [], returnType: 'object | null',
    description: 'Map of `ifname` → `wpas.iface`. NULL until an interface is added (verified on the running daemon).' }],
  ...msgConsts(),
]);

// ── wpas.iface (C resource) ───────────────────────────────────────────────────
const wpasIfaceMethods = new Map<string, FunctionSignature>([
  ['status', { name: 'status', parameters: [], returnType: 'object | null',
    description: 'Interface status `{ state, frequency?, sec_chan_offset?, links?, multi_ap? }`, or null if the iface is gone.' }],
  ['ctrl', { name: 'ctrl', parameters: [arg('cmd', 'string')], returnType: 'string | null',
    description: 'Send a control-interface command; returns the reply string, or null on error.' }],
  ['config', { name: 'config', parameters: [arg('name', 'string'), arg('value', 'string', true)], returnType: 'array | boolean | null',
    description: 'Get (1 arg, e.g. "freq_list") → array; or set (2 args) → true. Null on an unknown name / failure.' }],
  ['wps_set_m7', { name: 'wps_set_m7', parameters: [arg('data', 'string')], returnType: 'boolean | null',
    description: 'Set the WPS M7 payload. True on success; null on failure.' }],
  ['dpp_send_action', { name: 'dpp_send_action', parameters: [arg('dst', 'string'), arg('freq', 'integer'), arg('frame', 'string')], returnType: 'boolean | null',
    description: 'Send a DPP action frame (build-dependent: CONFIG_DPP). Null on bad args.' }],
  ['dpp_send_gas_req', { name: 'dpp_send_gas_req', parameters: [arg('dst', 'string'), arg('freq', 'integer'), arg('data', 'string'), arg('token', 'integer')], returnType: 'boolean | null',
    description: 'Send a DPP GAS request frame (build-dependent: CONFIG_DPP). Null on bad args.' }],
]);

/** Members that are properties/constants, not callable methods — for hover/formatting so a bare
 *  `hostapd.data` / `hostapd.MSG_INFO` reads as a value, not a call. */
export const HOSTAPD_VALUE_MEMBERS = new Set<string>([
  'data', 'interfaces', 'bss', 'MSG_EXCESSIVE', 'MSG_MSGDUMP', 'MSG_DEBUG', 'MSG_INFO', 'MSG_WARNING', 'MSG_ERROR',
]);

const globalFormatDoc = (obj: string) => (_n: string, sig: FunctionSignature): string =>
  HOSTAPD_VALUE_MEMBERS.has(sig.name)
    ? `**${obj}.${sig.name}**: \`${sig.returnType}\`\n\n${sig.description}`
    : `**${obj}.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`;

// `hostapd`/`wpas` globals are OPEN — the scripts add `.ubus`/etc. at runtime, so an unknown member
// is `unknown`, not UC5004. The `.bss`/`.iface` handles are pure C resources → strict.
export const hostapdGlobalObjectType: ObjectTypeDefinition = {
  typeName: 'hostapd.global', openMembers: true, methods: hostapdGlobalMethods, formatDoc: globalFormatDoc('hostapd'),
};
export const hostapdBssObjectType: ObjectTypeDefinition = {
  typeName: 'hostapd.bss', methods: hostapdBssMethods,
  formatDoc: (_n, sig) => `**hostapd.bss.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};
export const hostapdIfaceObjectType: ObjectTypeDefinition = {
  typeName: 'hostapd.iface', methods: hostapdIfaceMethods,
  formatDoc: (_n, sig) => `**hostapd.iface.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};
export const wpasGlobalObjectType: ObjectTypeDefinition = {
  typeName: 'wpas.global', openMembers: true, methods: wpasGlobalMethods, formatDoc: globalFormatDoc('wpas'),
};
export const wpasIfaceObjectType: ObjectTypeDefinition = {
  typeName: 'wpas.iface', methods: wpasIfaceMethods,
  formatDoc: (_n, sig) => `**wpas.iface.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

/** Member names of each global — the analyzer's usage-based detection signal. */
export const HOSTAPD_GLOBAL_MEMBERS: ReadonlySet<string> = new Set(hostapdGlobalMethods.keys());
export const WPAS_GLOBAL_MEMBERS: ReadonlySet<string> = new Set(wpasGlobalMethods.keys());
