/**
 * bpf module type definitions (ucode-mod-bpf) — load and interact with eBPF.
 *
 * Names are authoritative: module functions + constants from introspecting the real
 * `ucode-mod-bpf` package, and the object-handle method names from the vendored
 * source's `uc_function_list_t` tables (openwrt/package/utils/ucode-mod-bpf/src/bpf.c):
 *   module_fns:   get_map get_maps get_programs get_program
 *   map_fns:      pin get set delete delete_all foreach iterator
 *   prog_fns:     pin tc_attach
 *   map_iter_fns: next next_int
 *   global_fns:   error set_debug_handler open_module open_map open_program tc_detach
 *
 * Constructor/resource returns are typed `<handle> | null` (the C returns NULL on
 * error). Parameter types are kept permissive (the source carries no jsdoc) so we
 * never assert an unverified constraint — sound against false negatives.
 *
 * First available on OpenWrt 23.05 (feed package `ucode-mod-bpf`).
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ObjectTypeDefinition, ConstantDefinition } from './registryFactory';

const fn = (name: string, parameters: FunctionSignature['parameters'], returnType: string, description: string): [string, FunctionSignature] =>
  [name, { name, parameters, returnType, description }];

const ANY = (n: string, optional = false) => ({ name: n, type: 'any', optional });

// ---- module functions ----
const functions = new Map<string, FunctionSignature>([
  fn('open_module', [ANY('path', true)], 'bpf.module | null', 'Open a compiled eBPF object (module) and return a handle, or null on error.'),
  fn('open_map', [ANY('path')], 'bpf.map | null', 'Open a pinned eBPF map by path and return a handle, or null on error.'),
  fn('open_program', [ANY('path')], 'bpf.program | null', 'Open a pinned eBPF program by path and return a handle, or null on error.'),
  fn('tc_detach', [ANY('ifname'), ANY('direction', true)], 'boolean | null', 'Detach a previously attached tc (traffic control) eBPF program. Returns null on error.'),
  fn('set_debug_handler', [ANY('callback', true)], 'null', 'Install a callback invoked with libbpf debug/log output.'),
  fn('error', [], 'string | null', 'Return a description of the last bpf error, or null if none occurred.'),
]);

// ---- object-handle types ----
export const bpfModuleObjectType: ObjectTypeDefinition = {
  typeName: 'bpf.module',
  methods: new Map<string, FunctionSignature>([
    fn('get_map', [ANY('name')], 'bpf.map | null', 'Return a handle to the named map within this module, or null.'),
    fn('get_maps', [], 'array | null', 'Return an array of handles for all maps in this module, or null.'),
    fn('get_program', [ANY('name')], 'bpf.program | null', 'Return a handle to the named program within this module, or null.'),
    fn('get_programs', [], 'array | null', 'Return an array of handles for all programs in this module, or null.'),
  ]),
};

export const bpfMapObjectType: ObjectTypeDefinition = {
  typeName: 'bpf.map',
  methods: new Map<string, FunctionSignature>([
    fn('pin', [ANY('path')], 'boolean | null', 'Pin the map to the given bpffs path. Returns null on error.'),
    fn('get', [ANY('key')], 'any', 'Look up the value stored under the given key.'),
    fn('set', [ANY('key'), ANY('value'), ANY('flags', true)], 'boolean | null', 'Store a value under the given key. `flags` is one of BPF_ANY/BPF_NOEXIST/BPF_EXIST. Returns null on error.'),
    fn('delete', [ANY('key')], 'boolean | null', 'Delete the entry under the given key. Returns null on error.'),
    fn('delete_all', [], 'boolean | null', 'Delete all entries in the map. Returns null on error.'),
    fn('foreach', [ANY('callback')], 'boolean | null', 'Invoke the callback for each key/value entry in the map.'),
    fn('iterator', [], 'bpf.map.iterator | null', 'Return an iterator handle over the map entries, or null.'),
  ]),
};

export const bpfProgramObjectType: ObjectTypeDefinition = {
  typeName: 'bpf.program',
  methods: new Map<string, FunctionSignature>([
    fn('pin', [ANY('path')], 'boolean | null', 'Pin the program to the given bpffs path. Returns null on error.'),
    fn('tc_attach', [ANY('ifname'), ANY('direction', true), ANY('options', true)], 'any', 'Attach this program as a tc (traffic control) classifier/action on an interface.'),
  ]),
};

export const bpfMapIteratorObjectType: ObjectTypeDefinition = {
  typeName: 'bpf.map.iterator',
  methods: new Map<string, FunctionSignature>([
    fn('next', [], 'any', 'Advance to and return the next key in the map, or null at the end.'),
    fn('next_int', [], 'any', 'Advance to and return the next integer key in the map, or null at the end.'),
  ]),
};

// ---- constants (authoritative names from introspection) ----
export const bpfConstants = new Set([
  'BPF_PROG_TYPE_SCHED_CLS', 'BPF_PROG_TYPE_SCHED_ACT',
  'BPF_ANY', 'BPF_NOEXIST', 'BPF_EXIST', 'BPF_F_LOCK',
]);
const constantDefs = new Map<string, ConstantDefinition>(
  Array.from(bpfConstants).map(name => [name, { name, value: 'number', type: 'number', description: `bpf constant \`${name}\`.` }])
);

export const bpfModule: ModuleDefinition = {
  name: 'bpf',
  functions,
  constants: constantDefs,
  documentation: `## bpf Module

Load and interact with eBPF modules, maps, and programs (\`ucode-mod-bpf\`).

\`\`\`ucode
import { open_module, BPF_ANY } from 'bpf';
let mod = open_module('/lib/bpf/example.o');
let map = mod.get_map('counters');
map.set(0, 1, BPF_ANY);
\`\`\`

First available on OpenWrt **23.05** (feed package \`ucode-mod-bpf\`).

**Functions:** open_module, open_map, open_program, tc_detach, set_debug_handler, error
**Handles:** bpf.module, bpf.map (+ bpf.map.iterator), bpf.program
**Constants:** BPF_PROG_TYPE_SCHED_CLS, BPF_PROG_TYPE_SCHED_ACT, BPF_ANY, BPF_NOEXIST, BPF_EXIST, BPF_F_LOCK`,
  importValidation: {
    isValid: (name: string) => functions.has(name) || bpfConstants.has(name),
    getValidImports: () => [...Array.from(functions.keys()), ...Array.from(bpfConstants)],
  },
};
