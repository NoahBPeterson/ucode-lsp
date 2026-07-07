/**
 * rtnl module type definitions and function signatures
 * Based on ucode/lib/rtnl.c
 *
 * The rtnl module provides routing netlink interface operations
 * for communicating with the Linux kernel's routing subsystem.
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition, ObjectTypeDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

// The event listener returned by rtnl.listener() — mirrors ucode/lib/rtnl.c
// listener_fns[].
const rtnlListenerMethods = new Map<string, FunctionSignature>([
  ['set_commands', { name: 'set_commands', parameters: [
      { name: 'commands', type: 'array', optional: false },
    ], returnType: 'boolean | null', description: 'Replace the set of RTM_* command numbers this listener receives. Returns true on success, null on error.' }],
  ['close', { name: 'close', parameters: [], returnType: 'boolean | null', description: 'Stop and remove the listener. Returns true on success, null on error.' }],
]);

/** The rtnl event listener returned by rtnl.listener(). */
export const rtnlListenerObjectType: ObjectTypeDefinition = {
  typeName: 'rtnl.listener',
  methods: rtnlListenerMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**rtnl.listener.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

// Backwards-compat type aliases
export type RtnlFunctionSignature = FunctionSignature;
export type RtnlConstantSignature = ConstantDefinition;

const functions = new Map<string, FunctionSignature>([
  ["request", {
    name: "request",
    parameters: [
      { name: "cmd", type: "integer", optional: false },
      { name: "flags", type: "integer", optional: true },
      { name: "payload", type: "object", optional: true }
    ],
    returnType: "object | array | boolean | null",
    description: `Send a netlink request to the routing subsystem. The cmd parameter specifies the RTM_* command to execute. Optional flags can modify the request behavior (NLM_F_*). The payload object contains command-specific attributes.

**Example:**
\`\`\`ucode
// Get all routes
let routes = request(RTM_GETROUTE, NLM_F_DUMP);

// Add a new route
let result = request(RTM_NEWROUTE, NLM_F_CREATE | NLM_F_EXCL, {
    dst: "192.168.1.0/24",
    gateway: "192.168.1.1",
    oif: 2
});
\`\`\``
  }],
  ["listener", {
    name: "listener",
    parameters: [
      { name: "callback", type: "function", optional: false },
      { name: "cmds", type: "array", optional: true },
      { name: "groups", type: "array", optional: true }
    ],
    returnType: "rtnl.listener | null",
    description: `Create an event listener for routing netlink messages. The callback function is called when events are received. Optional cmds array contains RTM_* command constants to listen for. Optional groups array contains multicast groups to join.

**Example:**
\`\`\`ucode
// Listen for route changes
let l = listener(function(msg) {
  printf("Route event: %J\\n", msg);
}, [RTM_NEWROUTE, RTM_DELROUTE]);

// Listen for link changes
let linkListener = listener(function(msg) {
  printf("Link event: %J\\n", msg);
}, [RTM_NEWLINK, RTM_DELLINK]);
\`\`\``
  }],
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: `Returns the last rtnl error message, or null if no error occurred. This is typically called after a failed rtnl operation to get detailed error information.

**Example:**
\`\`\`ucode
let result = request(RTM_GETROUTE, NLM_F_DUMP);
if (!result) {
    let errorMsg = error();
    printf("RTNL error: %s\\n", errorMsg);
}
\`\`\``
  }]
]);

// Backwards-compat export
export { functions as rtnlFunctions };

export const rtnlConstants: Map<string, ConstantDefinition> = new Map([
  // RTNL Family Constants

  // RTM Commands - Base
  ["RTM_BASE", { name: "RTM_BASE", value: 16, type: "integer", description: "Base RTM message type" }],

  // RTM Commands - Link Management
  ["RTM_NEWLINK", { name: "RTM_NEWLINK", value: 16, type: "integer", description: "Create new network interface" }],
  ["RTM_DELLINK", { name: "RTM_DELLINK", value: 17, type: "integer", description: "Delete network interface" }],
  ["RTM_GETLINK", { name: "RTM_GETLINK", value: 18, type: "integer", description: "Get network interface information" }],
  ["RTM_SETLINK", { name: "RTM_SETLINK", value: 19, type: "integer", description: "Set network interface configuration" }],

  // RTM Commands - Address Management
  ["RTM_NEWADDR", { name: "RTM_NEWADDR", value: 20, type: "integer", description: "Add new address" }],
  ["RTM_DELADDR", { name: "RTM_DELADDR", value: 21, type: "integer", description: "Delete address" }],
  ["RTM_GETADDR", { name: "RTM_GETADDR", value: 22, type: "integer", description: "Get address information" }],

  // RTM Commands - Route Management
  ["RTM_NEWROUTE", { name: "RTM_NEWROUTE", value: 24, type: "integer", description: "Add new route" }],
  ["RTM_DELROUTE", { name: "RTM_DELROUTE", value: 25, type: "integer", description: "Delete route" }],
  ["RTM_GETROUTE", { name: "RTM_GETROUTE", value: 26, type: "integer", description: "Get route information" }],

  // RTM Commands - Neighbor Management
  ["RTM_NEWNEIGH", { name: "RTM_NEWNEIGH", value: 28, type: "integer", description: "Add new neighbor entry" }],
  ["RTM_DELNEIGH", { name: "RTM_DELNEIGH", value: 29, type: "integer", description: "Delete neighbor entry" }],
  ["RTM_GETNEIGH", { name: "RTM_GETNEIGH", value: 30, type: "integer", description: "Get neighbor information" }],

  // RTM Commands - Rule Management
  ["RTM_NEWRULE", { name: "RTM_NEWRULE", value: 32, type: "integer", description: "Add new routing rule" }],
  ["RTM_DELRULE", { name: "RTM_DELRULE", value: 33, type: "integer", description: "Delete routing rule" }],
  ["RTM_GETRULE", { name: "RTM_GETRULE", value: 34, type: "integer", description: "Get routing rule information" }],

  // RTM Commands - QDisc Management
  ["RTM_NEWQDISC", { name: "RTM_NEWQDISC", value: 36, type: "integer", description: "Add new queueing discipline" }],
  ["RTM_DELQDISC", { name: "RTM_DELQDISC", value: 37, type: "integer", description: "Delete queueing discipline" }],
  ["RTM_GETQDISC", { name: "RTM_GETQDISC", value: 38, type: "integer", description: "Get queueing discipline information" }],

  // RTM Commands - Traffic Class Management
  ["RTM_NEWTCLASS", { name: "RTM_NEWTCLASS", value: 40, type: "integer", description: "Add new traffic class" }],
  ["RTM_DELTCLASS", { name: "RTM_DELTCLASS", value: 41, type: "integer", description: "Delete traffic class" }],
  ["RTM_GETTCLASS", { name: "RTM_GETTCLASS", value: 42, type: "integer", description: "Get traffic class information" }],

  // RTM Commands - Traffic Filter Management
  ["RTM_NEWTFILTER", { name: "RTM_NEWTFILTER", value: 44, type: "integer", description: "Add new traffic filter" }],
  ["RTM_DELTFILTER", { name: "RTM_DELTFILTER", value: 45, type: "integer", description: "Delete traffic filter" }],
  ["RTM_GETTFILTER", { name: "RTM_GETTFILTER", value: 46, type: "integer", description: "Get traffic filter information" }],

  // RTM Commands - Action Management
  ["RTM_NEWACTION", { name: "RTM_NEWACTION", value: 48, type: "integer", description: "Add new traffic control action" }],
  ["RTM_DELACTION", { name: "RTM_DELACTION", value: 49, type: "integer", description: "Delete traffic control action" }],
  ["RTM_GETACTION", { name: "RTM_GETACTION", value: 50, type: "integer", description: "Get traffic control action information" }],

  // RTM Commands - Prefix Management
  ["RTM_NEWPREFIX", { name: "RTM_NEWPREFIX", value: 52, type: "integer", description: "Add new prefix" }],

  // RTM Commands - Multicast and Anycast
  ["RTM_GETMULTICAST", { name: "RTM_GETMULTICAST", value: 58, type: "integer", description: "Get multicast information" }],
  ["RTM_GETANYCAST", { name: "RTM_GETANYCAST", value: 62, type: "integer", description: "Get anycast information" }],

  // RTM Commands - Neighbor Table Management
  ["RTM_NEWNEIGHTBL", { name: "RTM_NEWNEIGHTBL", value: 64, type: "integer", description: "Create new neighbor table" }],
  ["RTM_GETNEIGHTBL", { name: "RTM_GETNEIGHTBL", value: 66, type: "integer", description: "Get neighbor table information" }],
  ["RTM_SETNEIGHTBL", { name: "RTM_SETNEIGHTBL", value: 67, type: "integer", description: "Set neighbor table configuration" }],

  // RTM Commands - Neighbor Discovery User Option
  ["RTM_NEWNDUSEROPT", { name: "RTM_NEWNDUSEROPT", value: 68, type: "integer", description: "New neighbor discovery user option" }],

  // RTM Commands - Address Label Management
  ["RTM_NEWADDRLABEL", { name: "RTM_NEWADDRLABEL", value: 72, type: "integer", description: "Add new address label" }],
  ["RTM_DELADDRLABEL", { name: "RTM_DELADDRLABEL", value: 73, type: "integer", description: "Delete address label" }],
  ["RTM_GETADDRLABEL", { name: "RTM_GETADDRLABEL", value: 74, type: "integer", description: "Get address label information" }],

  // RTM Commands - DCB (Data Center Bridging)
  ["RTM_GETDCB", { name: "RTM_GETDCB", value: 78, type: "integer", description: "Get DCB information" }],
  ["RTM_SETDCB", { name: "RTM_SETDCB", value: 79, type: "integer", description: "Set DCB configuration" }],

  // RTM Commands - Network Configuration
  ["RTM_NEWNETCONF", { name: "RTM_NEWNETCONF", value: 80, type: "integer", description: "New network configuration" }],
  ["RTM_DELNETCONF", { name: "RTM_DELNETCONF", value: 81, type: "integer", description: "Delete network configuration" }],
  ["RTM_GETNETCONF", { name: "RTM_GETNETCONF", value: 82, type: "integer", description: "Get network configuration" }],

  // RTM Commands - Multicast Database
  ["RTM_NEWMDB", { name: "RTM_NEWMDB", value: 84, type: "integer", description: "Add new multicast database entry" }],
  ["RTM_DELMDB", { name: "RTM_DELMDB", value: 85, type: "integer", description: "Delete multicast database entry" }],
  ["RTM_GETMDB", { name: "RTM_GETMDB", value: 86, type: "integer", description: "Get multicast database information" }],

  // RTM Commands - Network Namespace ID
  ["RTM_NEWNSID", { name: "RTM_NEWNSID", value: 88, type: "integer", description: "Add new network namespace ID" }],
  ["RTM_DELNSID", { name: "RTM_DELNSID", value: 89, type: "integer", description: "Delete network namespace ID" }],
  ["RTM_GETNSID", { name: "RTM_GETNSID", value: 90, type: "integer", description: "Get network namespace ID" }],

  // RTM Commands - Statistics
  ["RTM_NEWSTATS", { name: "RTM_NEWSTATS", value: 92, type: "integer", description: "New statistics" }],
  ["RTM_GETSTATS", { name: "RTM_GETSTATS", value: 94, type: "integer", description: "Get statistics" }],

  // RTM Commands - Cache Report
  ["RTM_NEWCACHEREPORT", { name: "RTM_NEWCACHEREPORT", value: 96, type: "integer", description: "New cache report" }],

  // RTM Commands - Chain Management
  ["RTM_NEWCHAIN", { name: "RTM_NEWCHAIN", value: 100, type: "integer", description: "Add new chain" }],
  ["RTM_DELCHAIN", { name: "RTM_DELCHAIN", value: 101, type: "integer", description: "Delete chain" }],
  ["RTM_GETCHAIN", { name: "RTM_GETCHAIN", value: 102, type: "integer", description: "Get chain information" }],

  // RTM Commands - Next Hop Management
  ["RTM_NEWNEXTHOP", { name: "RTM_NEWNEXTHOP", value: 104, type: "integer", description: "Add new next hop" }],
  ["RTM_DELNEXTHOP", { name: "RTM_DELNEXTHOP", value: 105, type: "integer", description: "Delete next hop" }],
  ["RTM_GETNEXTHOP", { name: "RTM_GETNEXTHOP", value: 106, type: "integer", description: "Get next hop information" }],

  // RTM Commands - Link Property Management
  ["RTM_NEWLINKPROP", { name: "RTM_NEWLINKPROP", value: 108, type: "integer", description: "Add new link property" }],
  ["RTM_DELLINKPROP", { name: "RTM_DELLINKPROP", value: 109, type: "integer", description: "Delete link property" }],
  ["RTM_GETLINKPROP", { name: "RTM_GETLINKPROP", value: 110, type: "integer", description: "Get link property information" }],

  // RTM Commands - VLAN Management
  ["RTM_NEWVLAN", { name: "RTM_NEWVLAN", value: 112, type: "integer", description: "Add new VLAN" }],
  ["RTM_DELVLAN", { name: "RTM_DELVLAN", value: 113, type: "integer", description: "Delete VLAN" }],
  ["RTM_GETVLAN", { name: "RTM_GETVLAN", value: 114, type: "integer", description: "Get VLAN information" }],

  // Route types
  ["RTN_UNSPEC", { name: "RTN_UNSPEC", value: 0, type: "integer", description: "Unknown route type" }],
  ["RTN_UNICAST", { name: "RTN_UNICAST", value: 1, type: "integer", description: "Gateway or direct route" }],
  ["RTN_LOCAL", { name: "RTN_LOCAL", value: 2, type: "integer", description: "Accept locally" }],
  ["RTN_BROADCAST", { name: "RTN_BROADCAST", value: 3, type: "integer", description: "Accept locally as broadcast" }],
  ["RTN_ANYCAST", { name: "RTN_ANYCAST", value: 4, type: "integer", description: "Accept locally as broadcast, but send as unicast" }],
  ["RTN_MULTICAST", { name: "RTN_MULTICAST", value: 5, type: "integer", description: "Multicast route" }],
  ["RTN_BLACKHOLE", { name: "RTN_BLACKHOLE", value: 6, type: "integer", description: "Drop packets" }],
  ["RTN_UNREACHABLE", { name: "RTN_UNREACHABLE", value: 7, type: "integer", description: "Destination unreachable" }],
  ["RTN_PROHIBIT", { name: "RTN_PROHIBIT", value: 8, type: "integer", description: "Administratively prohibited" }],
  ["RTN_THROW", { name: "RTN_THROW", value: 9, type: "integer", description: "Not in this table" }],
  ["RTN_NAT", { name: "RTN_NAT", value: 10, type: "integer", description: "Translate this address" }],
  ["RTN_XRESOLVE", { name: "RTN_XRESOLVE", value: 11, type: "integer", description: "Use external resolver" }],

  // Route Protocol Constants

  // Route Scope Constants
  ["RT_SCOPE_UNIVERSE", { name: "RT_SCOPE_UNIVERSE", value: 0, type: "integer", description: "Global route" }],
  ["RT_SCOPE_SITE", { name: "RT_SCOPE_SITE", value: 200, type: "integer", description: "Site-local route" }],
  ["RT_SCOPE_LINK", { name: "RT_SCOPE_LINK", value: 253, type: "integer", description: "Link-local route" }],
  ["RT_SCOPE_HOST", { name: "RT_SCOPE_HOST", value: 254, type: "integer", description: "Host-local route" }],
  ["RT_SCOPE_NOWHERE", { name: "RT_SCOPE_NOWHERE", value: 255, type: "integer", description: "Nowhere route" }],

  // Route table constants
  ["RT_TABLE_UNSPEC", { name: "RT_TABLE_UNSPEC", value: 0, type: "integer", description: "Unspecified routing table" }],
  ["RT_TABLE_COMPAT", { name: "RT_TABLE_COMPAT", value: 252, type: "integer", description: "Compatibility routing table" }],
  ["RT_TABLE_DEFAULT", { name: "RT_TABLE_DEFAULT", value: 253, type: "integer", description: "Default routing table" }],
  ["RT_TABLE_MAIN", { name: "RT_TABLE_MAIN", value: 254, type: "integer", description: "Main routing table" }],
  ["RT_TABLE_LOCAL", { name: "RT_TABLE_LOCAL", value: 255, type: "integer", description: "Local routing table" }],
  ["RT_TABLE_MAX", { name: "RT_TABLE_MAX", value: 0xFFFFFFFF, type: "integer", description: "Maximum routing table value" }],

  // Route Flags
  ["RTM_F_NOTIFY", { name: "RTM_F_NOTIFY", value: 0x100, type: "integer", description: "Notify user of route change" }],
  ["RTM_F_CLONED", { name: "RTM_F_CLONED", value: 0x200, type: "integer", description: "This route is cloned" }],
  ["RTM_F_EQUALIZE", { name: "RTM_F_EQUALIZE", value: 0x400, type: "integer", description: "Multipath equalizer" }],
  ["RTM_F_PREFIX", { name: "RTM_F_PREFIX", value: 0x800, type: "integer", description: "Prefix addresses" }],
  ["RTM_F_LOOKUP_TABLE", { name: "RTM_F_LOOKUP_TABLE", value: 0x1000, type: "integer", description: "Set rtm_table to FIB lookup result" }],
  ["RTM_F_FIB_MATCH", { name: "RTM_F_FIB_MATCH", value: 0x2000, type: "integer", description: "Return full fib lookup match" }],

  // Routing Attribute Types

  // Next Hop Flags

  // Bridge constants
  ["BRIDGE_FLAGS_MASTER", { name: "BRIDGE_FLAGS_MASTER", value: 1, type: "integer", description: "Bridge command to/from master" }],
  ["BRIDGE_FLAGS_SELF", { name: "BRIDGE_FLAGS_SELF", value: 2, type: "integer", description: "Bridge command to/from lowerdev" }],
  ["BRIDGE_MODE_UNSPEC", { name: "BRIDGE_MODE_UNSPEC", value: 0, type: "integer", description: "Unspecified bridge mode" }],
  ["BRIDGE_MODE_HAIRPIN", { name: "BRIDGE_MODE_HAIRPIN", value: 1, type: "integer", description: "Hairpin bridge mode" }],
  ["BRIDGE_MODE_VEB", { name: "BRIDGE_MODE_VEB", value: 0, type: "integer", description: "Default loopback mode" }],
  ["BRIDGE_MODE_VEPA", { name: "BRIDGE_MODE_VEPA", value: 1, type: "integer", description: "802.1Qbg defined VEPA mode" }],
  ["BRIDGE_MODE_UNDEF", { name: "BRIDGE_MODE_UNDEF", value: 0xFFFF, type: "integer", description: "Mode undefined" }],
  ["BRIDGE_VLAN_INFO_MASTER", { name: "BRIDGE_VLAN_INFO_MASTER", value: 1, type: "integer", description: "Operate on Bridge device as well" }],
  ["BRIDGE_VLAN_INFO_PVID", { name: "BRIDGE_VLAN_INFO_PVID", value: 2, type: "integer", description: "VLAN is PVID, ingress untagged" }],
  ["BRIDGE_VLAN_INFO_UNTAGGED", { name: "BRIDGE_VLAN_INFO_UNTAGGED", value: 4, type: "integer", description: "VLAN egresses untagged" }],
  ["BRIDGE_VLAN_INFO_RANGE_BEGIN", { name: "BRIDGE_VLAN_INFO_RANGE_BEGIN", value: 8, type: "integer", description: "VLAN is start of vlan range" }],
  ["BRIDGE_VLAN_INFO_RANGE_END", { name: "BRIDGE_VLAN_INFO_RANGE_END", value: 16, type: "integer", description: "VLAN is end of vlan range" }],
  ["BRIDGE_VLAN_INFO_BRENTRY", { name: "BRIDGE_VLAN_INFO_BRENTRY", value: 32, type: "integer", description: "Global bridge VLAN entry" }],
  ["MACVLAN_MODE_BRIDGE", { name: "MACVLAN_MODE_BRIDGE", value: 4, type: "integer", description: "Talk to bridge ports directly" }],
  ["LINK_XSTATS_TYPE_BRIDGE", { name: "LINK_XSTATS_TYPE_BRIDGE", value: 1, type: "integer", description: "Bridge extended statistics type" }],

  // Netlink Message Flags (commonly used with rtnl)
  ["NLM_F_REQUEST", { name: "NLM_F_REQUEST", value: 1, type: "integer", description: "This message is a request" }],
  ["NLM_F_MULTI", { name: "NLM_F_MULTI", value: 2, type: "integer", description: "Multipart message" }],
  ["NLM_F_ACK", { name: "NLM_F_ACK", value: 4, type: "integer", description: "Request an acknowledgment on errors" }],
  ["NLM_F_ECHO", { name: "NLM_F_ECHO", value: 8, type: "integer", description: "Echo this request" }],
  ["NLM_F_DUMP_INTR", { name: "NLM_F_DUMP_INTR", value: 16, type: "integer", description: "Dump was interrupted" }],
  ["NLM_F_DUMP_FILTERED", { name: "NLM_F_DUMP_FILTERED", value: 32, type: "integer", description: "Dump was filtered" }],
  ["NLM_F_ROOT", { name: "NLM_F_ROOT", value: 256, type: "integer", description: "Specify tree root" }],
  ["NLM_F_MATCH", { name: "NLM_F_MATCH", value: 512, type: "integer", description: "Dump all matching entries" }],
  ["NLM_F_DUMP", { name: "NLM_F_DUMP", value: 768, type: "integer", description: "Dump the table" }],
  ["NLM_F_ATOMIC", { name: "NLM_F_ATOMIC", value: 1024, type: "integer", description: "Use atomic operations" }],
  ["NLM_F_CREATE", { name: "NLM_F_CREATE", value: 1024, type: "integer", description: "Create if it does not exist" }],
  ["NLM_F_EXCL", { name: "NLM_F_EXCL", value: 512, type: "integer", description: "Do not touch, if it exists" }],
  ["NLM_F_REPLACE", { name: "NLM_F_REPLACE", value: 256, type: "integer", description: "Replace existing matching object" }],
  ["NLM_F_STRICT_CHK", { name: "NLM_F_STRICT_CHK", value: 32768, type: "integer", description: "Strict parameter checking" }],

  // Address Family Constants
  ["AF_UNSPEC", { name: "AF_UNSPEC", value: 0, type: "integer", description: "Unspecified address family" }],
  ["AF_INET", { name: "AF_INET", value: 2, type: "integer", description: "IPv4 address family" }],
  ["AF_INET6", { name: "AF_INET6", value: 10, type: "integer", description: "IPv6 address family" }],
  ["AF_MPLS", { name: "AF_MPLS", value: 28, type: "integer", description: "MPLS address family" }],
  ["AF_BRIDGE", { name: "AF_BRIDGE", value: 7, type: "integer", description: "Bridge address family" }],

  // Routing Multicast Groups
  ["RTNLGRP_NONE", { name: "RTNLGRP_NONE", value: 0, type: "integer", description: "No multicast group" }],
  ["RTNLGRP_LINK", { name: "RTNLGRP_LINK", value: 1, type: "integer", description: "Link layer multicast group" }],
  ["RTNLGRP_NOTIFY", { name: "RTNLGRP_NOTIFY", value: 2, type: "integer", description: "Routing notify multicast group" }],
  ["RTNLGRP_NEIGH", { name: "RTNLGRP_NEIGH", value: 3, type: "integer", description: "Neighbor multicast group" }],
  ["RTNLGRP_TC", { name: "RTNLGRP_TC", value: 4, type: "integer", description: "Traffic control multicast group" }],
  ["RTNLGRP_IPV4_IFADDR", { name: "RTNLGRP_IPV4_IFADDR", value: 5, type: "integer", description: "IPv4 interface address multicast group" }],
  ["RTNLGRP_IPV4_MROUTE", { name: "RTNLGRP_IPV4_MROUTE", value: 6, type: "integer", description: "IPv4 multicast route group" }],
  ["RTNLGRP_IPV4_ROUTE", { name: "RTNLGRP_IPV4_ROUTE", value: 7, type: "integer", description: "IPv4 route multicast group" }],
  ["RTNLGRP_IPV4_RULE", { name: "RTNLGRP_IPV4_RULE", value: 8, type: "integer", description: "IPv4 rule multicast group" }],
  ["RTNLGRP_IPV6_IFADDR", { name: "RTNLGRP_IPV6_IFADDR", value: 9, type: "integer", description: "IPv6 interface address multicast group" }],
  ["RTNLGRP_IPV6_MROUTE", { name: "RTNLGRP_IPV6_MROUTE", value: 10, type: "integer", description: "IPv6 multicast route group" }],
  ["RTNLGRP_IPV6_ROUTE", { name: "RTNLGRP_IPV6_ROUTE", value: 11, type: "integer", description: "IPv6 route multicast group" }],
  ["RTNLGRP_IPV6_IFINFO", { name: "RTNLGRP_IPV6_IFINFO", value: 12, type: "integer", description: "IPv6 interface info multicast group" }],
  ["RTNLGRP_DECnet_IFADDR", { name: "RTNLGRP_DECnet_IFADDR", value: 13, type: "integer", description: "DECnet interface address multicast group" }],
  ["RTNLGRP_DECnet_ROUTE", { name: "RTNLGRP_DECnet_ROUTE", value: 15, type: "integer", description: "DECnet route multicast group" }],
  ["RTNLGRP_DECnet_RULE", { name: "RTNLGRP_DECnet_RULE", value: 16, type: "integer", description: "DECnet rule multicast group" }],
  ["RTNLGRP_IPV6_PREFIX", { name: "RTNLGRP_IPV6_PREFIX", value: 18, type: "integer", description: "IPv6 prefix multicast group" }],
  ["RTNLGRP_IPV6_RULE", { name: "RTNLGRP_IPV6_RULE", value: 19, type: "integer", description: "IPv6 rule multicast group" }],
  ["RTNLGRP_ND_USEROPT", { name: "RTNLGRP_ND_USEROPT", value: 20, type: "integer", description: "Neighbor discovery user option multicast group" }],
  ["RTNLGRP_PHONET_IFADDR", { name: "RTNLGRP_PHONET_IFADDR", value: 21, type: "integer", description: "Phonet interface address multicast group" }],
  ["RTNLGRP_PHONET_ROUTE", { name: "RTNLGRP_PHONET_ROUTE", value: 22, type: "integer", description: "Phonet route multicast group" }],
  ["RTNLGRP_DCB", { name: "RTNLGRP_DCB", value: 23, type: "integer", description: "DCB multicast group" }],
  ["RTNLGRP_IPV4_NETCONF", { name: "RTNLGRP_IPV4_NETCONF", value: 24, type: "integer", description: "IPv4 network configuration multicast group" }],
  ["RTNLGRP_IPV6_NETCONF", { name: "RTNLGRP_IPV6_NETCONF", value: 25, type: "integer", description: "IPv6 network configuration multicast group" }],
  ["RTNLGRP_MDB", { name: "RTNLGRP_MDB", value: 26, type: "integer", description: "Multicast database multicast group" }],
  ["RTNLGRP_MPLS_ROUTE", { name: "RTNLGRP_MPLS_ROUTE", value: 27, type: "integer", description: "MPLS route multicast group" }],
  ["RTNLGRP_NSID", { name: "RTNLGRP_NSID", value: 28, type: "integer", description: "Network namespace ID multicast group" }],
  ["RTNLGRP_MPLS_NETCONF", { name: "RTNLGRP_MPLS_NETCONF", value: 29, type: "integer", description: "MPLS network configuration multicast group" }],
  ["RTNLGRP_IPV4_MROUTE_R", { name: "RTNLGRP_IPV4_MROUTE_R", value: 30, type: "integer", description: "IPv4 multicast route resolver multicast group" }],
  ["RTNLGRP_IPV6_MROUTE_R", { name: "RTNLGRP_IPV6_MROUTE_R", value: 31, type: "integer", description: "IPv6 multicast route resolver multicast group" }],
  ["RTNLGRP_NEXTHOP", { name: "RTNLGRP_NEXTHOP", value: 32, type: "integer", description: "Next hop multicast group" }],
  ["RTNLGRP_BRVLAN", { name: "RTNLGRP_BRVLAN", value: 33, type: "integer", description: "Bridge VLAN multicast group" }],

  // Traffic Control Action Constants

  // Traffic Control Action Flags

  // Extended Info Filters

  // --- Additional constants regenerated from ucode/lib/rtnl.c ADD_CONST (values from vendored linux/*.h; GRE_* are little-endian be16) ---
  ["FDB_NOTIFY_BIT", { name: "FDB_NOTIFY_BIT", value: 1, type: "integer", description: "Bridge FDB entry notification flag" }],
  ["FDB_NOTIFY_INACTIVE_BIT", { name: "FDB_NOTIFY_INACTIVE_BIT", value: 2, type: "integer", description: "Bridge FDB entry notification flag" }],
  ["FIB_RULE_DEV_DETACHED", { name: "FIB_RULE_DEV_DETACHED", value: 8, type: "integer", description: "FIB rule flag" }],
  ["FIB_RULE_IIF_DETACHED", { name: "FIB_RULE_IIF_DETACHED", value: 8, type: "integer", description: "FIB rule flag" }],
  ["FIB_RULE_INVERT", { name: "FIB_RULE_INVERT", value: 2, type: "integer", description: "FIB rule flag" }],
  ["FIB_RULE_OIF_DETACHED", { name: "FIB_RULE_OIF_DETACHED", value: 16, type: "integer", description: "FIB rule flag" }],
  ["FIB_RULE_PERMANENT", { name: "FIB_RULE_PERMANENT", value: 1, type: "integer", description: "FIB rule flag" }],
  ["FIB_RULE_UNRESOLVED", { name: "FIB_RULE_UNRESOLVED", value: 4, type: "integer", description: "FIB rule flag" }],
  ["FR_ACT_BLACKHOLE", { name: "FR_ACT_BLACKHOLE", value: 6, type: "integer", description: "FIB rule action" }],
  ["FR_ACT_GOTO", { name: "FR_ACT_GOTO", value: 2, type: "integer", description: "FIB rule action" }],
  ["FR_ACT_NOP", { name: "FR_ACT_NOP", value: 3, type: "integer", description: "FIB rule action" }],
  ["FR_ACT_PROHIBIT", { name: "FR_ACT_PROHIBIT", value: 8, type: "integer", description: "FIB rule action" }],
  ["FR_ACT_TO_TBL", { name: "FR_ACT_TO_TBL", value: 1, type: "integer", description: "FIB rule action" }],
  ["FR_ACT_UNREACHABLE", { name: "FR_ACT_UNREACHABLE", value: 7, type: "integer", description: "FIB rule action" }],
  ["GENEVE_DF_INHERIT", { name: "GENEVE_DF_INHERIT", value: 2, type: "integer", description: "GENEVE don't-fragment mode" }],
  ["GENEVE_DF_MAX", { name: "GENEVE_DF_MAX", value: 2, type: "integer", description: "GENEVE don't-fragment mode" }],
  ["GENEVE_DF_SET", { name: "GENEVE_DF_SET", value: 1, type: "integer", description: "GENEVE don't-fragment mode" }],
  ["GENEVE_DF_UNSET", { name: "GENEVE_DF_UNSET", value: 0, type: "integer", description: "GENEVE don't-fragment mode" }],
  ["GRE_ACK", { name: "GRE_ACK", value: 32768, type: "integer", description: "GRE header flag" }],
  ["GRE_CSUM", { name: "GRE_CSUM", value: 128, type: "integer", description: "GRE header flag" }],
  ["GRE_KEY", { name: "GRE_KEY", value: 32, type: "integer", description: "GRE header flag" }],
  ["GRE_REC", { name: "GRE_REC", value: 7, type: "integer", description: "GRE header flag" }],
  ["GRE_ROUTING", { name: "GRE_ROUTING", value: 64, type: "integer", description: "GRE header flag" }],
  ["GRE_SEQ", { name: "GRE_SEQ", value: 16, type: "integer", description: "GRE header flag" }],
  ["GRE_STRICT", { name: "GRE_STRICT", value: 8, type: "integer", description: "GRE header flag" }],
  ["GTP_ROLE_GGSN", { name: "GTP_ROLE_GGSN", value: 0, type: "integer", description: "GTP tunnel role" }],
  ["GTP_ROLE_SGSN", { name: "GTP_ROLE_SGSN", value: 1, type: "integer", description: "GTP tunnel role" }],
  ["HSR_PROTOCOL_HSR", { name: "HSR_PROTOCOL_HSR", value: 0, type: "integer", description: "HSR/PRP protocol mode" }],
  ["HSR_PROTOCOL_PRP", { name: "HSR_PROTOCOL_PRP", value: 1, type: "integer", description: "HSR/PRP protocol mode" }],
  ["IFA_F_DADFAILED", { name: "IFA_F_DADFAILED", value: 8, type: "integer", description: "Interface address flag" }],
  ["IFA_F_DEPRECATED", { name: "IFA_F_DEPRECATED", value: 32, type: "integer", description: "Interface address flag" }],
  ["IFA_F_HOMEADDRESS", { name: "IFA_F_HOMEADDRESS", value: 16, type: "integer", description: "Interface address flag" }],
  ["IFA_F_MANAGETEMPADDR", { name: "IFA_F_MANAGETEMPADDR", value: 256, type: "integer", description: "Interface address flag" }],
  ["IFA_F_MCAUTOJOIN", { name: "IFA_F_MCAUTOJOIN", value: 1024, type: "integer", description: "Interface address flag" }],
  ["IFA_F_NODAD", { name: "IFA_F_NODAD", value: 2, type: "integer", description: "Interface address flag" }],
  ["IFA_F_NOPREFIXROUTE", { name: "IFA_F_NOPREFIXROUTE", value: 512, type: "integer", description: "Interface address flag" }],
  ["IFA_F_OPTIMISTIC", { name: "IFA_F_OPTIMISTIC", value: 4, type: "integer", description: "Interface address flag" }],
  ["IFA_F_PERMANENT", { name: "IFA_F_PERMANENT", value: 128, type: "integer", description: "Interface address flag" }],
  ["IFA_F_SECONDARY", { name: "IFA_F_SECONDARY", value: 1, type: "integer", description: "Interface address flag" }],
  ["IFA_F_STABLE_PRIVACY", { name: "IFA_F_STABLE_PRIVACY", value: 2048, type: "integer", description: "Interface address flag" }],
  ["IFA_F_TEMPORARY", { name: "IFA_F_TEMPORARY", value: 1, type: "integer", description: "Interface address flag" }],
  ["IFA_F_TENTATIVE", { name: "IFA_F_TENTATIVE", value: 64, type: "integer", description: "Interface address flag" }],
  ["IN6_ADDR_GEN_MODE_EUI64", { name: "IN6_ADDR_GEN_MODE_EUI64", value: 0, type: "integer", description: "IPv6 address generation mode" }],
  ["IN6_ADDR_GEN_MODE_NONE", { name: "IN6_ADDR_GEN_MODE_NONE", value: 1, type: "integer", description: "IPv6 address generation mode" }],
  ["IN6_ADDR_GEN_MODE_RANDOM", { name: "IN6_ADDR_GEN_MODE_RANDOM", value: 3, type: "integer", description: "IPv6 address generation mode" }],
  ["IN6_ADDR_GEN_MODE_STABLE_PRIVACY", { name: "IN6_ADDR_GEN_MODE_STABLE_PRIVACY", value: 2, type: "integer", description: "IPv6 address generation mode" }],
  ["IP6_TNL_F_ALLOW_LOCAL_REMOTE", { name: "IP6_TNL_F_ALLOW_LOCAL_REMOTE", value: 64, type: "integer", description: "IPv6 tunnel flag" }],
  ["IP6_TNL_F_IGN_ENCAP_LIMIT", { name: "IP6_TNL_F_IGN_ENCAP_LIMIT", value: 1, type: "integer", description: "IPv6 tunnel flag" }],
  ["IP6_TNL_F_MIP6_DEV", { name: "IP6_TNL_F_MIP6_DEV", value: 8, type: "integer", description: "IPv6 tunnel flag" }],
  ["IP6_TNL_F_RCV_DSCP_COPY", { name: "IP6_TNL_F_RCV_DSCP_COPY", value: 16, type: "integer", description: "IPv6 tunnel flag" }],
  ["IP6_TNL_F_USE_ORIG_FLOWLABEL", { name: "IP6_TNL_F_USE_ORIG_FLOWLABEL", value: 4, type: "integer", description: "IPv6 tunnel flag" }],
  ["IP6_TNL_F_USE_ORIG_FWMARK", { name: "IP6_TNL_F_USE_ORIG_FWMARK", value: 32, type: "integer", description: "IPv6 tunnel flag" }],
  ["IP6_TNL_F_USE_ORIG_TCLASS", { name: "IP6_TNL_F_USE_ORIG_TCLASS", value: 2, type: "integer", description: "IPv6 tunnel flag" }],
  ["IPOIB_MODE_CONNECTED", { name: "IPOIB_MODE_CONNECTED", value: 1, type: "integer", description: "IP-over-InfiniBand mode" }],
  ["IPOIB_MODE_DATAGRAM", { name: "IPOIB_MODE_DATAGRAM", value: 0, type: "integer", description: "IP-over-InfiniBand mode" }],
  ["IPVLAN_MODE_L2", { name: "IPVLAN_MODE_L2", value: 0, type: "integer", description: "IPVLAN operating mode" }],
  ["IPVLAN_MODE_L3", { name: "IPVLAN_MODE_L3", value: 1, type: "integer", description: "IPVLAN operating mode" }],
  ["IPVLAN_MODE_L3S", { name: "IPVLAN_MODE_L3S", value: 2, type: "integer", description: "IPVLAN operating mode" }],
  ["LINK_XSTATS_TYPE_BOND", { name: "LINK_XSTATS_TYPE_BOND", value: 2, type: "integer", description: "Link extended-statistics type" }],
  ["LINK_XSTATS_TYPE_UNSPEC", { name: "LINK_XSTATS_TYPE_UNSPEC", value: 0, type: "integer", description: "Link extended-statistics type" }],
  ["MACSEC_OFFLOAD_MAC", { name: "MACSEC_OFFLOAD_MAC", value: 2, type: "integer", description: "MACsec offload mode" }],
  ["MACSEC_OFFLOAD_MAX", { name: "MACSEC_OFFLOAD_MAX", value: 2, type: "integer", description: "MACsec offload mode" }],
  ["MACSEC_OFFLOAD_OFF", { name: "MACSEC_OFFLOAD_OFF", value: 0, type: "integer", description: "MACsec offload mode" }],
  ["MACSEC_OFFLOAD_PHY", { name: "MACSEC_OFFLOAD_PHY", value: 1, type: "integer", description: "MACsec offload mode" }],
  ["MACSEC_VALIDATE_CHECK", { name: "MACSEC_VALIDATE_CHECK", value: 1, type: "integer", description: "MACsec validation mode" }],
  ["MACSEC_VALIDATE_DISABLED", { name: "MACSEC_VALIDATE_DISABLED", value: 0, type: "integer", description: "MACsec validation mode" }],
  ["MACSEC_VALIDATE_MAX", { name: "MACSEC_VALIDATE_MAX", value: 2, type: "integer", description: "MACsec validation mode" }],
  ["MACSEC_VALIDATE_STRICT", { name: "MACSEC_VALIDATE_STRICT", value: 2, type: "integer", description: "MACsec validation mode" }],
  ["MACVLAN_MACADDR_ADD", { name: "MACVLAN_MACADDR_ADD", value: 0, type: "integer", description: "MACVLAN MAC-address operation" }],
  ["MACVLAN_MACADDR_DEL", { name: "MACVLAN_MACADDR_DEL", value: 1, type: "integer", description: "MACVLAN MAC-address operation" }],
  ["MACVLAN_MACADDR_FLUSH", { name: "MACVLAN_MACADDR_FLUSH", value: 2, type: "integer", description: "MACVLAN MAC-address operation" }],
  ["MACVLAN_MACADDR_SET", { name: "MACVLAN_MACADDR_SET", value: 3, type: "integer", description: "MACVLAN MAC-address operation" }],
  ["MACVLAN_MODE_PASSTHRU", { name: "MACVLAN_MODE_PASSTHRU", value: 8, type: "integer", description: "MACVLAN operating mode" }],
  ["MACVLAN_MODE_PRIVATE", { name: "MACVLAN_MODE_PRIVATE", value: 1, type: "integer", description: "MACVLAN operating mode" }],
  ["MACVLAN_MODE_SOURCE", { name: "MACVLAN_MODE_SOURCE", value: 16, type: "integer", description: "MACVLAN operating mode" }],
  ["MACVLAN_MODE_VEPA", { name: "MACVLAN_MODE_VEPA", value: 2, type: "integer", description: "MACVLAN operating mode" }],
  ["NDUSEROPT_SRCADDR", { name: "NDUSEROPT_SRCADDR", value: 1, type: "integer", description: "Neighbour discovery user option attribute" }],
  ["NDUSEROPT_UNSPEC", { name: "NDUSEROPT_UNSPEC", value: 0, type: "integer", description: "Neighbour discovery user option attribute" }],
  ["NETCONFA_IFINDEX_ALL", { name: "NETCONFA_IFINDEX_ALL", value: -1, type: "integer", description: "Netconf interface index sentinel" }],
  ["NETCONFA_IFINDEX_DEFAULT", { name: "NETCONFA_IFINDEX_DEFAULT", value: -2, type: "integer", description: "Netconf interface index sentinel" }],
  ["NLM_F_ACK_TLVS", { name: "NLM_F_ACK_TLVS", value: 512, type: "integer", description: "Netlink message flag" }],
  ["NLM_F_APPEND", { name: "NLM_F_APPEND", value: 2048, type: "integer", description: "Netlink message flag" }],
  ["NLM_F_CAPPED", { name: "NLM_F_CAPPED", value: 256, type: "integer", description: "Netlink message flag" }],
  ["NLM_F_NONREC", { name: "NLM_F_NONREC", value: 256, type: "integer", description: "Netlink message flag" }],
  ["NTF_EXT_LEARNED", { name: "NTF_EXT_LEARNED", value: 16, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_MASTER", { name: "NTF_MASTER", value: 4, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_OFFLOADED", { name: "NTF_OFFLOADED", value: 32, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_PROXY", { name: "NTF_PROXY", value: 8, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_ROUTER", { name: "NTF_ROUTER", value: 128, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_SELF", { name: "NTF_SELF", value: 2, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_STICKY", { name: "NTF_STICKY", value: 64, type: "integer", description: "Neighbour cache entry flag" }],
  ["NTF_USE", { name: "NTF_USE", value: 1, type: "integer", description: "Neighbour cache entry flag" }],
  ["NUD_DELAY", { name: "NUD_DELAY", value: 8, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_FAILED", { name: "NUD_FAILED", value: 32, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_INCOMPLETE", { name: "NUD_INCOMPLETE", value: 1, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_NOARP", { name: "NUD_NOARP", value: 64, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_NONE", { name: "NUD_NONE", value: 0, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_PERMANENT", { name: "NUD_PERMANENT", value: 128, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_PROBE", { name: "NUD_PROBE", value: 16, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_REACHABLE", { name: "NUD_REACHABLE", value: 2, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["NUD_STALE", { name: "NUD_STALE", value: 4, type: "integer", description: "Neighbour Unreachability Detection state" }],
  ["PORT_PROFILE_RESPONSE_BADSTATE", { name: "PORT_PROFILE_RESPONSE_BADSTATE", value: 259, type: "integer", description: "802.1Qbg port profile response code" }],
  ["PORT_PROFILE_RESPONSE_ERROR", { name: "PORT_PROFILE_RESPONSE_ERROR", value: 261, type: "integer", description: "802.1Qbg port profile response code" }],
  ["PORT_PROFILE_RESPONSE_INPROGRESS", { name: "PORT_PROFILE_RESPONSE_INPROGRESS", value: 257, type: "integer", description: "802.1Qbg port profile response code" }],
  ["PORT_PROFILE_RESPONSE_INSUFFICIENT_RESOURCES", { name: "PORT_PROFILE_RESPONSE_INSUFFICIENT_RESOURCES", value: 260, type: "integer", description: "802.1Qbg port profile response code" }],
  ["PORT_PROFILE_RESPONSE_INVALID", { name: "PORT_PROFILE_RESPONSE_INVALID", value: 258, type: "integer", description: "802.1Qbg port profile response code" }],
  ["PORT_PROFILE_RESPONSE_SUCCESS", { name: "PORT_PROFILE_RESPONSE_SUCCESS", value: 256, type: "integer", description: "802.1Qbg port profile response code" }],
  ["PORT_REQUEST_ASSOCIATE", { name: "PORT_REQUEST_ASSOCIATE", value: 2, type: "integer", description: "802.1Qbg port request type" }],
  ["PORT_REQUEST_DISASSOCIATE", { name: "PORT_REQUEST_DISASSOCIATE", value: 3, type: "integer", description: "802.1Qbg port request type" }],
  ["PORT_REQUEST_PREASSOCIATE", { name: "PORT_REQUEST_PREASSOCIATE", value: 0, type: "integer", description: "802.1Qbg port request type" }],
  ["PORT_REQUEST_PREASSOCIATE_RR", { name: "PORT_REQUEST_PREASSOCIATE_RR", value: 1, type: "integer", description: "802.1Qbg port request type" }],
  ["PORT_VDP_RESPONSE_INSUFFICIENT_RESOURCES", { name: "PORT_VDP_RESPONSE_INSUFFICIENT_RESOURCES", value: 2, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PORT_VDP_RESPONSE_INVALID_FORMAT", { name: "PORT_VDP_RESPONSE_INVALID_FORMAT", value: 1, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PORT_VDP_RESPONSE_OUT_OF_SYNC", { name: "PORT_VDP_RESPONSE_OUT_OF_SYNC", value: 6, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PORT_VDP_RESPONSE_SUCCESS", { name: "PORT_VDP_RESPONSE_SUCCESS", value: 0, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PORT_VDP_RESPONSE_UNUSED_VTID", { name: "PORT_VDP_RESPONSE_UNUSED_VTID", value: 3, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PORT_VDP_RESPONSE_VTID_VERSION_VIOALTION", { name: "PORT_VDP_RESPONSE_VTID_VERSION_VIOALTION", value: 5, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PORT_VDP_RESPONSE_VTID_VIOLATION", { name: "PORT_VDP_RESPONSE_VTID_VIOLATION", value: 4, type: "integer", description: "802.1Qbg VDP response code" }],
  ["PREFIX_ADDRESS", { name: "PREFIX_ADDRESS", value: 1, type: "integer", description: "Route prefix attribute" }],
  ["PREFIX_CACHEINFO", { name: "PREFIX_CACHEINFO", value: 2, type: "integer", description: "Route prefix attribute" }],
  ["PREFIX_UNSPEC", { name: "PREFIX_UNSPEC", value: 0, type: "integer", description: "Route prefix attribute" }],
  ["RTAX_ADVMSS", { name: "RTAX_ADVMSS", value: 8, type: "integer", description: "Route metric attribute" }],
  ["RTAX_CC_ALGO", { name: "RTAX_CC_ALGO", value: 16, type: "integer", description: "Route metric attribute" }],
  ["RTAX_CWND", { name: "RTAX_CWND", value: 7, type: "integer", description: "Route metric attribute" }],
  ["RTAX_FASTOPEN_NO_COOKIE", { name: "RTAX_FASTOPEN_NO_COOKIE", value: 17, type: "integer", description: "Route metric attribute" }],
  ["RTAX_FEATURES", { name: "RTAX_FEATURES", value: 12, type: "integer", description: "Route metric attribute" }],
  ["RTAX_HOPLIMIT", { name: "RTAX_HOPLIMIT", value: 10, type: "integer", description: "Route metric attribute" }],
  ["RTAX_INITCWND", { name: "RTAX_INITCWND", value: 11, type: "integer", description: "Route metric attribute" }],
  ["RTAX_INITRWND", { name: "RTAX_INITRWND", value: 14, type: "integer", description: "Route metric attribute" }],
  ["RTAX_MTU", { name: "RTAX_MTU", value: 2, type: "integer", description: "Route metric attribute" }],
  ["RTAX_QUICKACK", { name: "RTAX_QUICKACK", value: 15, type: "integer", description: "Route metric attribute" }],
  ["RTAX_REORDERING", { name: "RTAX_REORDERING", value: 9, type: "integer", description: "Route metric attribute" }],
  ["RTAX_RTT", { name: "RTAX_RTT", value: 4, type: "integer", description: "Route metric attribute" }],
  ["RTAX_RTTVAR", { name: "RTAX_RTTVAR", value: 5, type: "integer", description: "Route metric attribute" }],
  ["RTAX_SSTHRESH", { name: "RTAX_SSTHRESH", value: 6, type: "integer", description: "Route metric attribute" }],
  ["RTAX_WINDOW", { name: "RTAX_WINDOW", value: 3, type: "integer", description: "Route metric attribute" }],
  ["RTNLGRP_NOP2", { name: "RTNLGRP_NOP2", value: 14, type: "integer", description: "Routing netlink multicast group" }],
  ["RTNLGRP_NOP4", { name: "RTNLGRP_NOP4", value: 17, type: "integer", description: "Routing netlink multicast group" }],
  ["TUNNEL_ENCAP_FLAG_CSUM", { name: "TUNNEL_ENCAP_FLAG_CSUM", value: 1, type: "integer", description: "Tunnel encapsulation flag" }],
  ["TUNNEL_ENCAP_FLAG_CSUM6", { name: "TUNNEL_ENCAP_FLAG_CSUM6", value: 2, type: "integer", description: "Tunnel encapsulation flag" }],
  ["TUNNEL_ENCAP_FLAG_REMCSUM", { name: "TUNNEL_ENCAP_FLAG_REMCSUM", value: 4, type: "integer", description: "Tunnel encapsulation flag" }],
  ["TUNNEL_ENCAP_FOU", { name: "TUNNEL_ENCAP_FOU", value: 1, type: "integer", description: "Tunnel encapsulation type" }],
  ["TUNNEL_ENCAP_GUE", { name: "TUNNEL_ENCAP_GUE", value: 2, type: "integer", description: "Tunnel encapsulation type" }],
  ["TUNNEL_ENCAP_MPLS", { name: "TUNNEL_ENCAP_MPLS", value: 3, type: "integer", description: "Tunnel encapsulation type" }],
  ["TUNNEL_ENCAP_NONE", { name: "TUNNEL_ENCAP_NONE", value: 0, type: "integer", description: "Tunnel encapsulation type" }],
  ["VXLAN_DF_INHERIT", { name: "VXLAN_DF_INHERIT", value: 2, type: "integer", description: "VXLAN don't-fragment mode" }],
  ["VXLAN_DF_MAX", { name: "VXLAN_DF_MAX", value: 2, type: "integer", description: "VXLAN don't-fragment mode" }],
  ["VXLAN_DF_SET", { name: "VXLAN_DF_SET", value: 1, type: "integer", description: "VXLAN don't-fragment mode" }],
  ["VXLAN_DF_UNSET", { name: "VXLAN_DF_UNSET", value: 0, type: "integer", description: "VXLAN don't-fragment mode" }],
  ["XDP_ATTACHED_DRV", { name: "XDP_ATTACHED_DRV", value: 1, type: "integer", description: "XDP program attach mode" }],
  ["XDP_ATTACHED_HW", { name: "XDP_ATTACHED_HW", value: 3, type: "integer", description: "XDP program attach mode" }],
  ["XDP_ATTACHED_MULTI", { name: "XDP_ATTACHED_MULTI", value: 4, type: "integer", description: "XDP program attach mode" }],
  ["XDP_ATTACHED_NONE", { name: "XDP_ATTACHED_NONE", value: 0, type: "integer", description: "XDP program attach mode" }],
  ["XDP_ATTACHED_SKB", { name: "XDP_ATTACHED_SKB", value: 2, type: "integer", description: "XDP program attach mode" }],
]);

export const rtnlModule: ModuleDefinition = {
  name: 'rtnl',
  functions,
  constants: rtnlConstants,
  documentation: `## RTNL Module

**Routing Netlink functionality for ucode scripts**

The rtnl module provides routing netlink functionality for ucode, allowing you to interact with the Linux kernel's routing and network interface subsystem.

### Usage

**Named import syntax:**
\`\`\`ucode
import { request, listener, error, RTM_GETROUTE, NLM_F_DUMP } from 'rtnl';

let routes = request(RTM_GETROUTE, NLM_F_DUMP);
if (!routes) print('Error: ', error(), '\\n');
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as rtnl from 'rtnl';

let routes = rtnl.request(rtnl.RTM_GETROUTE, rtnl.NLM_F_DUMP);
\`\`\`

### Available Functions

- **\`request()\`** - Send a netlink request to the routing subsystem
- **\`listener()\`** - Create an event listener for routing netlink messages
- **\`error()\`** - Get the last rtnl error message

*Hover over individual function and constant names for detailed information.*`,
  importValidation: {
    isValid: (name: string) => functions.has(name) || name === 'const',
    getValidImports: () => [...Array.from(functions.keys()), 'const'],
  },
};

// Backwards compatibility
export const rtnlTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isRtnlFunction: (name: string) => functions.has(name),
  getConstantNames: () => Array.from(rtnlConstants.keys()),
  getConstant: (name: string) => rtnlConstants.get(name),
  isRtnlConstant: (name: string) => rtnlConstants.has(name),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('rtnl', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('rtnl', func);
  },
  getConstantDocumentation: (name: string) => {
    const constant = rtnlConstants.get(name);
    if (!constant) return '';
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  },
  isValidImport: (name: string) => functions.has(name) || name === 'const',
  getValidImports: () => [...Array.from(functions.keys()), 'const'],
  isValidRtnlImport: (name: string) => functions.has(name) || name === 'const',
};