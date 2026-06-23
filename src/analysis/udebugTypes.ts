/**
 * udebug module type definitions (ucode-mod-udebug) — OpenWrt runtime debug rings.
 *
 * Authoritative exports (functions + constants) from introspecting the real
 * `ucode-mod-udebug` package on OpenWrt 24.10 (first feed appearance):
 *   functions: init create_ring get_ring trace_ring foreach_packet pcap_file pcap_udp
 *   constants: FORMAT_PACKET FORMAT_STRING FORMAT_BLOBMSG
 *              DLT_ETHERNET DLT_PPP DLT_IEEE_802_11 DLT_IEEE_802_11_RADIOTAP DLT_NETLINK
 *
 * Ring/pcap handles require live setup to construct (introspection segfaults on a
 * bare create) and the upstream C has no jsdoc, so handle-returning calls are typed
 * permissively as `object | null` and parameters are left unconstrained — sound
 * against false negatives.
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition } from './registryFactory';

const ANY = (n: string, optional = false) => ({ name: n, type: 'any', optional });
const fn = (name: string, parameters: FunctionSignature['parameters'], returnType: string, description: string): [string, FunctionSignature] =>
  [name, { name, parameters, returnType, description }];

const functions = new Map<string, FunctionSignature>([
  fn('init', [ANY('name', true), ANY('options', true)], 'any', 'Initialize the udebug subsystem for this process.'),
  fn('create_ring', [ANY('config')], 'object | null', 'Create a debug ring buffer from the given config. Returns a ring handle, or null.'),
  fn('get_ring', [ANY('name')], 'object | null', 'Look up an existing debug ring by name. Returns a ring handle, or null.'),
  fn('trace_ring', [ANY('config', true)], 'object | null', 'Create or obtain a trace ring. Returns a ring handle, or null.'),
  fn('foreach_packet', [ANY('source'), ANY('callback')], 'any', 'Iterate packets from a ring/pcap source, invoking the callback for each.'),
  fn('pcap_file', [ANY('path'), ANY('options', true)], 'object | null', 'Open a pcap file source. Returns a handle, or null.'),
  fn('pcap_udp', [ANY('options', true)], 'object | null', 'Open a UDP pcap source. Returns a handle, or null.'),
]);

export { functions as udebugFunctions };

export const udebugConstants = new Set([
  'FORMAT_PACKET', 'FORMAT_STRING', 'FORMAT_BLOBMSG',
  'DLT_ETHERNET', 'DLT_PPP', 'DLT_IEEE_802_11', 'DLT_IEEE_802_11_RADIOTAP', 'DLT_NETLINK',
]);
const constantDefs = new Map<string, ConstantDefinition>(
  Array.from(udebugConstants).map(name => [name, { name, value: 'number', type: 'number', description: `udebug constant \`${name}\`.` }])
);

export const udebugModule: ModuleDefinition = {
  name: 'udebug',
  functions,
  constants: constantDefs,
  documentation: `## udebug Module

OpenWrt runtime debug ring buffers and packet capture (\`ucode-mod-udebug\`).

\`\`\`ucode
import { create_ring, FORMAT_STRING } from 'udebug';
let ring = create_ring({ name: 'mylog', format: FORMAT_STRING, size: 65536, entries: 1024 });
\`\`\`

First available on OpenWrt **24.10** (feed package \`ucode-mod-udebug\`).

**Functions:** init, create_ring, get_ring, trace_ring, foreach_packet, pcap_file, pcap_udp
**Constants:** FORMAT_PACKET, FORMAT_STRING, FORMAT_BLOBMSG, DLT_ETHERNET, DLT_PPP, DLT_IEEE_802_11, DLT_IEEE_802_11_RADIOTAP, DLT_NETLINK`,
  importValidation: {
    isValid: (name: string) => functions.has(name) || udebugConstants.has(name),
    getValidImports: () => [...Array.from(functions.keys()), ...Array.from(udebugConstants)],
  },
};
