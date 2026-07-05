/**
 * The `netifd` ambient object injected into OpenWrt netifd ucode scripts. There are TWO
 * distinct shapes with different sources and version floors (verified against netifd's C
 * source, git.openwrt.org/project/netifd.git, and the OpenWrt release branches):
 *
 *  1. PROTO handlers (`lib/netifd/proto/*.uc`) — injected by `proto-ucode.uc` via
 *     `include(script_path, { netifd: netifd_stub })`; the stub is `{ add_proto }`.
 *     First ships in OpenWrt **main** (proto-ucode.uc landed 2026-02, after 25.12 branched).
 *
 *  2. DAEMON / wireless scripts (`main.uc`, `wireless*.uc`, `/usr/share/ucode/wifi/*.uc`) —
 *     the netifd C daemon binds a rich `netifd` global into the VM scope before running
 *     `main.uc` (ucode.c: `ucv_object_add(uc_vm_scope_get(&vm), "netifd", obj)` +
 *     `uc_function_list_register(obj, netifd_fns)` + `ADD_CONST(L_*)`). First ships in
 *     OpenWrt **25.12** (main.uc landed there).
 *
 * Seeded ONLY in the matching handler context — a non-netifd script referencing `netifd`
 * still gets UC1001. See SemanticAnalyzer.declareNetifdAmbient and docs/netifd-injected-global.md.
 *
 * Signatures below are from netifd's C (ucode.c / proto-ucode.c, HEAD 2026-02-15). Properties
 * and integer constants are carried as zero-arg members (typed to their value), mirroring the
 * uhttpd ambient, so a bare `netifd.main_path` / `netifd.L_WARNING` resolves to its type.
 */
import type { FunctionSignature } from './moduleTypes';
import type { ObjectTypeDefinition } from './registryFactory';

const arg = (name: string, type: string, optional = false): FunctionSignature['parameters'][number] =>
  ({ name, type, optional });

// ── proto handler: `netifd = { add_proto }` (proto-ucode.uc stub) ──────────────
const netifdProtoMethods = new Map<string, FunctionSignature>([
  ['add_proto', { name: 'add_proto', parameters: [arg('handler', 'object')], returnType: 'null',
    description: 'Register a protocol handler. `handler` is an object with a `name` string plus the action functions (`config`/`setup`/`teardown`/`renew`/…), each called with the proto context. Stored by `handler.name`.' }],
]);

/** The `netifd` object a proto handler script receives (`lib/netifd/proto/*.uc`). OpenWrt main+. */
export const netifdProtoObjectType: ObjectTypeDefinition = {
  typeName: 'netifd.proto',
  methods: netifdProtoMethods,
  formatDoc: (_n, sig) => `**netifd.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

// ── daemon / wireless: the C-injected rich global (ucode.c) ────────────────────
const netifdDaemonMethods = new Map<string, FunctionSignature>([
  // methods (netifd_fns[])
  ['log', { name: 'log', parameters: [arg('priority', 'integer'), arg('message', 'string')], returnType: 'null',
    description: 'Emit a log message at the given priority (use the `L_*` constants). No-op if the args are the wrong type.' }],
  ['debug', { name: 'debug', parameters: [arg('message', 'string')], returnType: 'null',
    description: 'Emit a udebug trace message.' }],
  ['process', { name: 'process', parameters: [arg('opts', 'object')], returnType: 'object | null',
    description: 'Spawn a managed child process. `opts`: { argv: array (required), envp?: array, dir?: string, cb: function (required), log_prefix?: string }. Returns a process handle with `.cancel()`, or null on error.' }],
  ['process_check', { name: 'process_check', parameters: [arg('pid', 'integer'), arg('exe', 'string')], returnType: 'boolean',
    description: 'Return true if the given pid is alive and its executable path matches `exe`.' }],
  ['device_set', { name: 'device_set', parameters: [arg('name', 'string'), arg('data', 'object')], returnType: 'boolean',
    description: 'Register/update a device with netifd. Returns true on success.' }],
  ['interface_get_enabled', { name: 'interface_get_enabled', parameters: [arg('network', 'string')], returnType: 'object | null',
    description: 'Return `{ enabled: bool, ifindex?: int }` for the named network interface, or null if unknown.' }],
  ['interface_handle_link', { name: 'interface_handle_link', parameters: [arg('info', 'object')], returnType: 'boolean',
    description: 'Signal a link up/down event. `info`: { name: string, ifname: string, vlan?: array, up?: bool, link_ext?: bool }. Returns true on success.' }],
  ['interface_get_bridge', { name: 'interface_get_bridge', parameters: [arg('network', 'string'), arg('obj', 'object')], returnType: 'object | null',
    description: 'If the network is bridged, augment `obj` with `bridge`/`bridge-ifname` and return it; otherwise return `obj` unchanged or null.' }],
  ['add_proto', { name: 'add_proto', parameters: [arg('handler', 'object')], returnType: 'boolean',
    description: 'Register a protocol handler (object with a `name` and action functions). Returns true on success.' }],
  // properties (carried as zero-arg members)
  ['cb', { name: 'cb', parameters: [], returnType: 'object',
    description: 'Callback registry object (populated by main.uc: hotplug/config_init/config_start/check_interfaces).' }],
  ['main_path', { name: 'main_path', parameters: [], returnType: 'string',
    description: 'The netifd main script directory path.' }],
  ['config_path', { name: 'config_path', parameters: [], returnType: 'string',
    description: 'The UCI config directory path (present only when configured).' }],
  ['dummy_mode', { name: 'dummy_mode', parameters: [], returnType: 'boolean',
    description: 'True when netifd is built in dummy/test mode (present only in DUMMY_MODE builds).' }],
  // log-level constants (int), carried as zero-arg members
  ['L_CRIT', { name: 'L_CRIT', parameters: [], returnType: 'integer', description: 'Log priority constant: critical.' }],
  ['L_WARNING', { name: 'L_WARNING', parameters: [], returnType: 'integer', description: 'Log priority constant: warning.' }],
  ['L_NOTICE', { name: 'L_NOTICE', parameters: [], returnType: 'integer', description: 'Log priority constant: notice.' }],
  ['L_INFO', { name: 'L_INFO', parameters: [], returnType: 'integer', description: 'Log priority constant: info.' }],
  ['L_DEBUG', { name: 'L_DEBUG', parameters: [], returnType: 'integer', description: 'Log priority constant: debug.' }],
]);

/** Members that are properties/constants, not callable methods — for hover/formatting and so
 *  a bare access (no call) is the natural read. */
export const NETIFD_DAEMON_VALUE_MEMBERS = new Set([
  'cb', 'main_path', 'config_path', 'dummy_mode', 'L_CRIT', 'L_WARNING', 'L_NOTICE', 'L_INFO', 'L_DEBUG',
]);

/** The rich `netifd` global the daemon/wireless scripts receive. OpenWrt 25.12+.
 *  OPEN: the runtime extends `netifd` in ucode (`netifd.ubus = …`, `netifd.wireless = …`) and
 *  the wireless/hostapd framework adds more (`setup_failed`/`set_vlan`/…), so a member outside
 *  the C `netifd_fns[]` set is NOT an error — it resolves to `unknown`. Known members below
 *  still type/hover/complete. */
export const netifdDaemonObjectType: ObjectTypeDefinition = {
  typeName: 'netifd.daemon',
  openMembers: true,
  methods: netifdDaemonMethods,
  formatDoc: (_n, sig) => NETIFD_DAEMON_VALUE_MEMBERS.has(sig.name)
    ? `**netifd.${sig.name}**: \`${sig.returnType}\`\n\n${sig.description}`
    : `**netifd.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

/** All member names of each shape — used by the analyzer's usage-based shape detection. */
export const NETIFD_PROTO_MEMBERS: ReadonlySet<string> = new Set(netifdProtoMethods.keys());
export const NETIFD_DAEMON_MEMBERS: ReadonlySet<string> = new Set(netifdDaemonMethods.keys());
/** Members that ONLY the daemon shape has (i.e. not `add_proto`) — a usage of any of these is
 *  a decisive signal for the daemon shape. */
export const NETIFD_DAEMON_ONLY_MEMBERS: ReadonlySet<string> =
  new Set([...netifdDaemonMethods.keys()].filter((m) => !NETIFD_PROTO_MEMBERS.has(m)));
