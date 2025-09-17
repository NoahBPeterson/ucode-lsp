/**
 * rtnl module type definitions and function signatures
 * Based on ucode/lib/rtnl.c
 * 
 * The rtnl module provides routing netlink interface operations
 * for communicating with the Linux kernel's routing subsystem.
 */

export interface RtnlFunctionSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: any;
  }>;
  returnType: string;
  description: string;
}

export interface RtnlConstantSignature {
  name: string;
  value: string | number;
  type: string;
  description: string;
}

export const rtnlFunctions: Map<string, RtnlFunctionSignature> = new Map([
  ["request", {
    name: "request",
    parameters: [
      { name: "cmd", type: "integer", optional: false },
      { name: "flags", type: "integer", optional: true },
      { name: "payload", type: "object", optional: true }
    ],
    returnType: "object | null",
    description: "Send a netlink request to the routing subsystem. The cmd parameter specifies the RTM_* command to execute. Optional flags can modify the request behavior (NLM_F_*). The payload object contains command-specific attributes."
  }],
  ["listener", {
    name: "listener",
    parameters: [
      { name: "callback", type: "function", optional: false },
      { name: "cmds", type: "array", optional: true },
      { name: "groups", type: "array", optional: true }
    ],
    returnType: "rtnl.listener",
    description: "Create an event listener for routing netlink messages. The callback function is called when events are received. Optional cmds array contains RTM_* command constants to listen for. Optional groups array contains multicast groups to join."
  }],
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: "Returns the last rtnl error message, or null if no error occurred. This is typically called after a failed rtnl operation to get detailed error information."
  }]
]);

export const rtnlConstants: Map<string, RtnlConstantSignature> = new Map([
  // RTNL Family Constants
  ["RTNL_FAMILY_IPMR", { name: "RTNL_FAMILY_IPMR", value: 128, type: "integer", description: "IP multicast routing family" }],
  ["RTNL_FAMILY_IP6MR", { name: "RTNL_FAMILY_IP6MR", value: 129, type: "integer", description: "IPv6 multicast routing family" }],
  ["RTNL_FAMILY_MAX", { name: "RTNL_FAMILY_MAX", value: 129, type: "integer", description: "Maximum RTNL family value" }],

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
  ["RTPROT_UNSPEC", { name: "RTPROT_UNSPEC", value: 0, type: "integer", description: "Unspecified protocol" }],
  ["RTPROT_REDIRECT", { name: "RTPROT_REDIRECT", value: 1, type: "integer", description: "Route installed by ICMP redirects" }],
  ["RTPROT_KERNEL", { name: "RTPROT_KERNEL", value: 2, type: "integer", description: "Route installed by kernel" }],
  ["RTPROT_BOOT", { name: "RTPROT_BOOT", value: 3, type: "integer", description: "Route installed during boot" }],
  ["RTPROT_STATIC", { name: "RTPROT_STATIC", value: 4, type: "integer", description: "Route installed by administrator" }],
  ["RTPROT_GATED", { name: "RTPROT_GATED", value: 8, type: "integer", description: "GateD routing daemon" }],
  ["RTPROT_RA", { name: "RTPROT_RA", value: 9, type: "integer", description: "RDISC/ND router advertisements" }],
  ["RTPROT_MRT", { name: "RTPROT_MRT", value: 10, type: "integer", description: "Merit MRT routing daemon" }],
  ["RTPROT_ZEBRA", { name: "RTPROT_ZEBRA", value: 11, type: "integer", description: "Zebra routing daemon" }],
  ["RTPROT_BIRD", { name: "RTPROT_BIRD", value: 12, type: "integer", description: "BIRD routing daemon" }],
  ["RTPROT_DNROUTED", { name: "RTPROT_DNROUTED", value: 13, type: "integer", description: "DECnet routing daemon" }],
  ["RTPROT_XORP", { name: "RTPROT_XORP", value: 14, type: "integer", description: "XORP routing daemon" }],
  ["RTPROT_NTK", { name: "RTPROT_NTK", value: 15, type: "integer", description: "Netsukuku routing daemon" }],
  ["RTPROT_DHCP", { name: "RTPROT_DHCP", value: 16, type: "integer", description: "DHCP client" }],
  ["RTPROT_MROUTED", { name: "RTPROT_MROUTED", value: 17, type: "integer", description: "Multicast daemon" }],
  ["RTPROT_KEEPALIVED", { name: "RTPROT_KEEPALIVED", value: 18, type: "integer", description: "Keepalived daemon" }],
  ["RTPROT_BABEL", { name: "RTPROT_BABEL", value: 42, type: "integer", description: "Babel routing daemon" }],
  ["RTPROT_BGP", { name: "RTPROT_BGP", value: 186, type: "integer", description: "BGP routing protocol" }],
  ["RTPROT_ISIS", { name: "RTPROT_ISIS", value: 187, type: "integer", description: "ISIS routing protocol" }],
  ["RTPROT_OSPF", { name: "RTPROT_OSPF", value: 188, type: "integer", description: "OSPF routing protocol" }],
  ["RTPROT_RIP", { name: "RTPROT_RIP", value: 189, type: "integer", description: "RIP routing protocol" }],
  ["RTPROT_EIGRP", { name: "RTPROT_EIGRP", value: 192, type: "integer", description: "EIGRP routing protocol" }],

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
  ["RTM_F_OFFLOAD", { name: "RTM_F_OFFLOAD", value: 0x4000, type: "integer", description: "Route is offloaded" }],
  ["RTM_F_TRAP", { name: "RTM_F_TRAP", value: 0x8000, type: "integer", description: "Route is trapping packets" }],
  ["RTM_F_OFFLOAD_FAILED", { name: "RTM_F_OFFLOAD_FAILED", value: 0x20000000, type: "integer", description: "Route offload failed" }],

  // Routing Attribute Types
  ["RTA_UNSPEC", { name: "RTA_UNSPEC", value: 0, type: "integer", description: "Unspecified attribute" }],
  ["RTA_DST", { name: "RTA_DST", value: 1, type: "integer", description: "Destination address" }],
  ["RTA_SRC", { name: "RTA_SRC", value: 2, type: "integer", description: "Source address" }],
  ["RTA_IIF", { name: "RTA_IIF", value: 3, type: "integer", description: "Input interface index" }],
  ["RTA_OIF", { name: "RTA_OIF", value: 4, type: "integer", description: "Output interface index" }],
  ["RTA_GATEWAY", { name: "RTA_GATEWAY", value: 5, type: "integer", description: "Gateway address" }],
  ["RTA_PRIORITY", { name: "RTA_PRIORITY", value: 6, type: "integer", description: "Route priority" }],
  ["RTA_PREFSRC", { name: "RTA_PREFSRC", value: 7, type: "integer", description: "Preferred source address" }],
  ["RTA_METRICS", { name: "RTA_METRICS", value: 8, type: "integer", description: "Route metrics" }],
  ["RTA_MULTIPATH", { name: "RTA_MULTIPATH", value: 9, type: "integer", description: "Multipath route data" }],
  ["RTA_PROTOINFO", { name: "RTA_PROTOINFO", value: 10, type: "integer", description: "Protocol info (deprecated)" }],
  ["RTA_FLOW", { name: "RTA_FLOW", value: 11, type: "integer", description: "Route flow" }],
  ["RTA_CACHEINFO", { name: "RTA_CACHEINFO", value: 12, type: "integer", description: "Route cache information" }],
  ["RTA_SESSION", { name: "RTA_SESSION", value: 13, type: "integer", description: "Session data (deprecated)" }],
  ["RTA_MP_ALGO", { name: "RTA_MP_ALGO", value: 14, type: "integer", description: "Multipath algorithm (deprecated)" }],
  ["RTA_TABLE", { name: "RTA_TABLE", value: 15, type: "integer", description: "Routing table ID" }],
  ["RTA_MARK", { name: "RTA_MARK", value: 16, type: "integer", description: "Netfilter mark" }],
  ["RTA_MFC_STATS", { name: "RTA_MFC_STATS", value: 17, type: "integer", description: "Multicast forwarding cache stats" }],
  ["RTA_VIA", { name: "RTA_VIA", value: 18, type: "integer", description: "Gateway in different AF" }],
  ["RTA_NEWDST", { name: "RTA_NEWDST", value: 19, type: "integer", description: "New destination for redirect" }],
  ["RTA_PREF", { name: "RTA_PREF", value: 20, type: "integer", description: "Route preference" }],
  ["RTA_ENCAP_TYPE", { name: "RTA_ENCAP_TYPE", value: 21, type: "integer", description: "Encapsulation type" }],
  ["RTA_ENCAP", { name: "RTA_ENCAP", value: 22, type: "integer", description: "Encapsulation data" }],
  ["RTA_EXPIRES", { name: "RTA_EXPIRES", value: 23, type: "integer", description: "Route expiration time" }],
  ["RTA_PAD", { name: "RTA_PAD", value: 24, type: "integer", description: "Padding for alignment" }],
  ["RTA_UID", { name: "RTA_UID", value: 25, type: "integer", description: "User ID" }],
  ["RTA_TTL_PROPAGATE", { name: "RTA_TTL_PROPAGATE", value: 26, type: "integer", description: "TTL propagation" }],
  ["RTA_IP_PROTO", { name: "RTA_IP_PROTO", value: 27, type: "integer", description: "IP protocol" }],
  ["RTA_SPORT", { name: "RTA_SPORT", value: 28, type: "integer", description: "Source port" }],
  ["RTA_DPORT", { name: "RTA_DPORT", value: 29, type: "integer", description: "Destination port" }],
  ["RTA_NH_ID", { name: "RTA_NH_ID", value: 30, type: "integer", description: "Next hop ID" }],

  // Next Hop Flags
  ["RTNH_F_DEAD", { name: "RTNH_F_DEAD", value: 1, type: "integer", description: "Nexthop is dead (used by multipath)" }],
  ["RTNH_F_PERVASIVE", { name: "RTNH_F_PERVASIVE", value: 2, type: "integer", description: "Do recursive gateway lookup" }],
  ["RTNH_F_ONLINK", { name: "RTNH_F_ONLINK", value: 4, type: "integer", description: "Gateway is forced on link" }],
  ["RTNH_F_OFFLOAD", { name: "RTNH_F_OFFLOAD", value: 8, type: "integer", description: "Nexthop is offloaded" }],
  ["RTNH_F_LINKDOWN", { name: "RTNH_F_LINKDOWN", value: 16, type: "integer", description: "Carrier-down on nexthop" }],
  ["RTNH_F_UNRESOLVED", { name: "RTNH_F_UNRESOLVED", value: 32, type: "integer", description: "The entry is unresolved (ipmr)" }],
  ["RTNH_F_TRAP", { name: "RTNH_F_TRAP", value: 64, type: "integer", description: "Nexthop is trapping packets" }],

  // Bridge constants
  ["BRIDGE_FLAGS_MASTER", { name: "BRIDGE_FLAGS_MASTER", value: 1, type: "integer", description: "Bridge master flag" }],
  ["BRIDGE_FLAGS_SELF", { name: "BRIDGE_FLAGS_SELF", value: 2, type: "integer", description: "Bridge self flag" }],

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
  ["TCA_ROOT_UNSPEC", { name: "TCA_ROOT_UNSPEC", value: 0, type: "integer", description: "Unspecified TC action root" }],
  ["TCA_ROOT_TAB", { name: "TCA_ROOT_TAB", value: 1, type: "integer", description: "TC action table" }],
  ["TCA_ROOT_FLAGS", { name: "TCA_ROOT_FLAGS", value: 2, type: "integer", description: "TC action root flags" }],
  ["TCA_ROOT_COUNT", { name: "TCA_ROOT_COUNT", value: 3, type: "integer", description: "TC action root count" }],
  ["TCA_ROOT_TIME_DELTA", { name: "TCA_ROOT_TIME_DELTA", value: 4, type: "integer", description: "TC action root time delta in msecs" }],

  // Traffic Control Action Flags
  ["TCA_FLAG_LARGE_DUMP_ON", { name: "TCA_FLAG_LARGE_DUMP_ON", value: 1, type: "integer", description: "Large dump flag" }],
  ["TCA_ACT_FLAG_LARGE_DUMP_ON", { name: "TCA_ACT_FLAG_LARGE_DUMP_ON", value: 1, type: "integer", description: "Large dump flag for actions" }],
  ["TCA_ACT_FLAG_TERSE_DUMP", { name: "TCA_ACT_FLAG_TERSE_DUMP", value: 2, type: "integer", description: "Terse dump flag for actions" }],

  // Extended Info Filters
  ["RTEXT_FILTER_VF", { name: "RTEXT_FILTER_VF", value: 1, type: "integer", description: "Virtual function filter" }],
  ["RTEXT_FILTER_BRVLAN", { name: "RTEXT_FILTER_BRVLAN", value: 2, type: "integer", description: "Bridge VLAN filter" }],
  ["RTEXT_FILTER_BRVLAN_COMPRESSED", { name: "RTEXT_FILTER_BRVLAN_COMPRESSED", value: 4, type: "integer", description: "Bridge VLAN compressed filter" }],
  ["RTEXT_FILTER_SKIP_STATS", { name: "RTEXT_FILTER_SKIP_STATS", value: 8, type: "integer", description: "Skip statistics filter" }],
  ["RTEXT_FILTER_MRP", { name: "RTEXT_FILTER_MRP", value: 16, type: "integer", description: "Media Redundancy Protocol filter" }],
  ["RTEXT_FILTER_CFM_CONFIG", { name: "RTEXT_FILTER_CFM_CONFIG", value: 32, type: "integer", description: "Connectivity Fault Management config filter" }],
  ["RTEXT_FILTER_CFM_STATUS", { name: "RTEXT_FILTER_CFM_STATUS", value: 64, type: "integer", description: "Connectivity Fault Management status filter" }]
]);

export class RtnlTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(rtnlFunctions.keys());
  }

  getFunction(name: string): RtnlFunctionSignature | undefined {
    return rtnlFunctions.get(name);
  }

  isRtnlFunction(name: string): boolean {
    return rtnlFunctions.has(name);
  }

  getConstantNames(): string[] {
    return Array.from(rtnlConstants.keys());
  }

  getConstant(name: string): RtnlConstantSignature | undefined {
    return rtnlConstants.get(name);
  }

  isRtnlConstant(name: string): boolean {
    return rtnlConstants.has(name);
  }

  formatFunctionSignature(name: string): string {
    const func = this.getFunction(name);
    if (!func) return '';
    
    const params = func.parameters.map(p => {
      if (p.optional && p.defaultValue !== undefined) {
        return `[${p.name}: ${p.type}] = ${p.defaultValue}`;
      } else if (p.optional) {
        return `[${p.name}: ${p.type}]`;
      } else {
        return `${p.name}: ${p.type}`;
      }
    }).join(', ');
    
    return `${name}(${params}): ${func.returnType}`;
  }

  getFunctionDocumentation(name: string): string {
    const func = this.getFunction(name);
    if (!func) return '';
    
    const signature = this.formatFunctionSignature(name);
    let doc = `**${signature}**\n\n${func.description}\n\n`;
    
    if (func.parameters.length > 0) {
      doc += '**Parameters:**\n';
      func.parameters.forEach(param => {
        const optional = param.optional ? ' (optional)' : '';
        const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
        doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\n`;
      });
      doc += '\n';
    }
    
    doc += `**Returns:** \`${func.returnType}\`\n\n`;
    
    // Add usage examples
    if (name === 'request') {
      doc += '**Example:**\n```ucode\n// Get all routes\nlet routes = request(RTM_GETROUTE, NLM_F_DUMP);\n\n// Add a new route\nlet result = request(RTM_NEWROUTE, NLM_F_CREATE | NLM_F_EXCL, {\n    dst: "192.168.1.0/24",\n    gateway: "192.168.1.1",\n    oif: 2\n});\n```';
    } else if (name === 'listener') {
      doc += '**Example:**\n```ucode\n// Listen for route changes\nlet l = listener(function(msg) {\n  printf("Route event: %J\\n", msg);\n}, [RTM_NEWROUTE, RTM_DELROUTE]);\n\n// Listen for link changes\nlet linkListener = listener(function(msg) {\n  printf("Link event: %J\\n", msg);\n}, [RTM_NEWLINK, RTM_DELLINK]);\n```';
    } else if (name === 'error') {
      doc += '**Example:**\n```ucode\nlet result = request(RTM_GETROUTE, NLM_F_DUMP);\nif (!result) {\n    let errorMsg = error();\n    printf("RTNL error: %s\\n", errorMsg);\n}\n```';
    }
    
    return doc;
  }

  getConstantDocumentation(name: string): string {
    const constant = this.getConstant(name);
    if (!constant) return '';
    
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  }

  // Import validation methods
  isValidImport(name: string): boolean {
    return this.isRtnlFunction(name) || this.isRtnlConstant(name);
  }

  getValidImports(): string[] {
    return [...this.getFunctionNames(), ...this.getConstantNames(), 'const'];
  }

  isValidRtnlImport(name: string): boolean {
    return this.getValidImports().includes(name);
  }
}

export const rtnlTypeRegistry = new RtnlTypeRegistry();