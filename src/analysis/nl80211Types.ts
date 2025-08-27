/**
 * nl80211 module type definitions and function signatures
 * Based on ucode/lib/nl80211.c
 * 
 * The nl80211 module provides WiFi/802.11 networking interface operations
 * for communicating with the Linux kernel's nl80211 subsystem.
 */

export interface Nl80211FunctionSignature {
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

export interface Nl80211ConstantSignature {
  name: string;
  value: string | number;
  type: string;
  description: string;
}

export const nl80211Functions: Map<string, Nl80211FunctionSignature> = new Map([
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: "Returns the last nl80211 error message, or null if no error occurred. This is typically called after a failed nl80211 operation to get detailed error information."
  }],
  ["request", {
    name: "request",
    parameters: [
      { name: "cmd", type: "integer", optional: false },
      { name: "flags", type: "integer", optional: true },
      { name: "payload", type: "object", optional: true }
    ],
    returnType: "object | null",
    description: "Sends a netlink request to the nl80211 subsystem. The cmd parameter specifies the NL80211_CMD_* command to execute. Optional flags can modify the request behavior (NLM_F_*). The payload object contains command-specific attributes."
  }],
  ["waitfor", {
    name: "waitfor",
    parameters: [
      { name: "cmds", type: "array", optional: false },
      { name: "timeout", type: "integer", optional: true }
    ],
    returnType: "object | null",
    description: "Waits for specific nl80211 commands to be received. The cmds array contains NL80211_CMD_* constants to wait for. Optional timeout specifies the maximum wait time in milliseconds. Returns the received message object or null on timeout."
  }],
  ["listener", {
    name: "listener",
    parameters: [
      { name: "callback", type: "function", optional: false },
      { name: "cmds", type: "array", optional: false }
    ],
    returnType: "nl80211.listener",
    description: "Creates an event listener for nl80211 messages. The callback function is called when any of the specified commands (NL80211_CMD_* constants) are received. Returns a listener object with set_commands() and close() methods."
  }]
]);

export const nl80211Constants: Map<string, Nl80211ConstantSignature> = new Map([
  // Netlink Message Flags
  ["NLM_F_ACK", { name: "NLM_F_ACK", value: 0x04, type: "integer", description: "Request an acknowledgment on errors" }],
  ["NLM_F_ACK_TLVS", { name: "NLM_F_ACK_TLVS", value: 0x200, type: "integer", description: "Extended ACK TLVs were included" }],
  ["NLM_F_APPEND", { name: "NLM_F_APPEND", value: 0x800, type: "integer", description: "Append the new entry to the end of the list" }],
  ["NLM_F_ATOMIC", { name: "NLM_F_ATOMIC", value: 0x400, type: "integer", description: "Use atomic operations" }],
  ["NLM_F_CAPPED", { name: "NLM_F_CAPPED", value: 0x100, type: "integer", description: "Dump was capped" }],
  ["NLM_F_CREATE", { name: "NLM_F_CREATE", value: 0x400, type: "integer", description: "Create if it does not exist" }],
  ["NLM_F_DUMP", { name: "NLM_F_DUMP", value: 0x300, type: "integer", description: "Dump the table" }],
  ["NLM_F_DUMP_FILTERED", { name: "NLM_F_DUMP_FILTERED", value: 0x20, type: "integer", description: "Dump was filtered" }],
  ["NLM_F_DUMP_INTR", { name: "NLM_F_DUMP_INTR", value: 0x10, type: "integer", description: "Dump was interrupted" }],
  ["NLM_F_ECHO", { name: "NLM_F_ECHO", value: 0x08, type: "integer", description: "Echo this request" }],
  ["NLM_F_EXCL", { name: "NLM_F_EXCL", value: 0x200, type: "integer", description: "Do not touch, if it exists" }],
  ["NLM_F_MATCH", { name: "NLM_F_MATCH", value: 0x200, type: "integer", description: "Dump all matching entries" }],
  ["NLM_F_MULTI", { name: "NLM_F_MULTI", value: 0x02, type: "integer", description: "Multipart message" }],
  ["NLM_F_NONREC", { name: "NLM_F_NONREC", value: 0x100, type: "integer", description: "Do not delete recursively" }],
  ["NLM_F_REPLACE", { name: "NLM_F_REPLACE", value: 0x100, type: "integer", description: "Replace existing matching object" }],
  ["NLM_F_REQUEST", { name: "NLM_F_REQUEST", value: 0x01, type: "integer", description: "This message is a request" }],
  ["NLM_F_ROOT", { name: "NLM_F_ROOT", value: 0x100, type: "integer", description: "Specify tree root" }],

  // IPv6 Address Generation Mode Constants
  ["IN6_ADDR_GEN_MODE_EUI64", { name: "IN6_ADDR_GEN_MODE_EUI64", value: 0, type: "integer", description: "IPv6 address generation using EUI-64" }],
  ["IN6_ADDR_GEN_MODE_NONE", { name: "IN6_ADDR_GEN_MODE_NONE", value: 1, type: "integer", description: "No IPv6 address generation" }],
  ["IN6_ADDR_GEN_MODE_STABLE_PRIVACY", { name: "IN6_ADDR_GEN_MODE_STABLE_PRIVACY", value: 2, type: "integer", description: "IPv6 stable privacy address generation" }],
  ["IN6_ADDR_GEN_MODE_RANDOM", { name: "IN6_ADDR_GEN_MODE_RANDOM", value: 3, type: "integer", description: "IPv6 random address generation" }],

  // Bridge Mode Constants
  ["BRIDGE_MODE_UNSPEC", { name: "BRIDGE_MODE_UNSPEC", value: 0, type: "integer", description: "Unspecified bridge mode" }],
  ["BRIDGE_MODE_HAIRPIN", { name: "BRIDGE_MODE_HAIRPIN", value: 1, type: "integer", description: "Bridge hairpin mode" }],

  // MACVLAN Mode Constants
  ["MACVLAN_MODE_PRIVATE", { name: "MACVLAN_MODE_PRIVATE", value: 1, type: "integer", description: "MACVLAN private mode" }],
  ["MACVLAN_MODE_VEPA", { name: "MACVLAN_MODE_VEPA", value: 2, type: "integer", description: "MACVLAN Virtual Ethernet Port Aggregator mode" }],
  ["MACVLAN_MODE_BRIDGE", { name: "MACVLAN_MODE_BRIDGE", value: 4, type: "integer", description: "MACVLAN bridge mode" }],
  ["MACVLAN_MODE_PASSTHRU", { name: "MACVLAN_MODE_PASSTHRU", value: 8, type: "integer", description: "MACVLAN passthrough mode" }],
  ["MACVLAN_MODE_SOURCE", { name: "MACVLAN_MODE_SOURCE", value: 16, type: "integer", description: "MACVLAN source mode" }],

  // MACVLAN MAC Address Constants
  ["MACVLAN_MACADDR_ADD", { name: "MACVLAN_MACADDR_ADD", value: 0, type: "integer", description: "Add MAC address to MACVLAN" }],
  ["MACVLAN_MACADDR_DEL", { name: "MACVLAN_MACADDR_DEL", value: 1, type: "integer", description: "Delete MAC address from MACVLAN" }],
  ["MACVLAN_MACADDR_FLUSH", { name: "MACVLAN_MACADDR_FLUSH", value: 2, type: "integer", description: "Flush MAC addresses from MACVLAN" }],
  ["MACVLAN_MACADDR_SET", { name: "MACVLAN_MACADDR_SET", value: 3, type: "integer", description: "Set MAC addresses for MACVLAN" }],

  // MACSEC Validation Constants
  ["MACSEC_VALIDATE_DISABLED", { name: "MACSEC_VALIDATE_DISABLED", value: 0, type: "integer", description: "MACSEC validation disabled" }],
  ["MACSEC_VALIDATE_CHECK", { name: "MACSEC_VALIDATE_CHECK", value: 1, type: "integer", description: "MACSEC validation check mode" }],
  ["MACSEC_VALIDATE_STRICT", { name: "MACSEC_VALIDATE_STRICT", value: 2, type: "integer", description: "MACSEC strict validation mode" }],
  ["MACSEC_VALIDATE_MAX", { name: "MACSEC_VALIDATE_MAX", value: 2, type: "integer", description: "MACSEC maximum validation mode" }],

  // MACSEC Offload Constants
  ["MACSEC_OFFLOAD_OFF", { name: "MACSEC_OFFLOAD_OFF", value: 0, type: "integer", description: "MACSEC offload disabled" }],
  ["MACSEC_OFFLOAD_PHY", { name: "MACSEC_OFFLOAD_PHY", value: 1, type: "integer", description: "MACSEC PHY offload" }],
  ["MACSEC_OFFLOAD_MAC", { name: "MACSEC_OFFLOAD_MAC", value: 2, type: "integer", description: "MACSEC MAC offload" }],
  ["MACSEC_OFFLOAD_MAX", { name: "MACSEC_OFFLOAD_MAX", value: 2, type: "integer", description: "MACSEC maximum offload mode" }],

  // IPVLAN Mode Constants
  ["IPVLAN_MODE_L2", { name: "IPVLAN_MODE_L2", value: 0, type: "integer", description: "IPVLAN Layer 2 mode" }],
  ["IPVLAN_MODE_L3", { name: "IPVLAN_MODE_L3", value: 1, type: "integer", description: "IPVLAN Layer 3 mode" }],
  ["IPVLAN_MODE_L3S", { name: "IPVLAN_MODE_L3S", value: 2, type: "integer", description: "IPVLAN Layer 3 symmetric mode" }],

  // VXLAN Don't Fragment Constants
  ["VXLAN_DF_UNSET", { name: "VXLAN_DF_UNSET", value: 0, type: "integer", description: "VXLAN Don't Fragment unset" }],
  ["VXLAN_DF_SET", { name: "VXLAN_DF_SET", value: 1, type: "integer", description: "VXLAN Don't Fragment set" }],
  ["VXLAN_DF_INHERIT", { name: "VXLAN_DF_INHERIT", value: 2, type: "integer", description: "VXLAN Don't Fragment inherit" }],
  ["VXLAN_DF_MAX", { name: "VXLAN_DF_MAX", value: 2, type: "integer", description: "VXLAN Don't Fragment maximum" }],

  // GENEVE Don't Fragment Constants
  ["GENEVE_DF_UNSET", { name: "GENEVE_DF_UNSET", value: 0, type: "integer", description: "GENEVE Don't Fragment unset" }],
  ["GENEVE_DF_SET", { name: "GENEVE_DF_SET", value: 1, type: "integer", description: "GENEVE Don't Fragment set" }],
  ["GENEVE_DF_INHERIT", { name: "GENEVE_DF_INHERIT", value: 2, type: "integer", description: "GENEVE Don't Fragment inherit" }],
  ["GENEVE_DF_MAX", { name: "GENEVE_DF_MAX", value: 2, type: "integer", description: "GENEVE Don't Fragment maximum" }],

  // GTP Role Constants
  ["GTP_ROLE_GGSN", { name: "GTP_ROLE_GGSN", value: 0, type: "integer", description: "GTP Gateway GPRS Support Node role" }],
  ["GTP_ROLE_SGSN", { name: "GTP_ROLE_SGSN", value: 1, type: "integer", description: "GTP Serving GPRS Support Node role" }],

  // Port Request Constants
  ["PORT_REQUEST_PREASSOCIATE", { name: "PORT_REQUEST_PREASSOCIATE", value: 0, type: "integer", description: "Port request pre-associate" }],
  ["PORT_REQUEST_PREASSOCIATE_RR", { name: "PORT_REQUEST_PREASSOCIATE_RR", value: 1, type: "integer", description: "Port request pre-associate with resource reservation" }],
  ["PORT_REQUEST_ASSOCIATE", { name: "PORT_REQUEST_ASSOCIATE", value: 2, type: "integer", description: "Port request associate" }],
  ["PORT_REQUEST_DISASSOCIATE", { name: "PORT_REQUEST_DISASSOCIATE", value: 3, type: "integer", description: "Port request disassociate" }],

  // Port VDP Response Constants
  ["PORT_VDP_RESPONSE_SUCCESS", { name: "PORT_VDP_RESPONSE_SUCCESS", value: 0, type: "integer", description: "Port VDP response success" }],
  ["PORT_VDP_RESPONSE_INVALID_FORMAT", { name: "PORT_VDP_RESPONSE_INVALID_FORMAT", value: 1, type: "integer", description: "Port VDP response invalid format" }],
  ["PORT_VDP_RESPONSE_INSUFFICIENT_RESOURCES", { name: "PORT_VDP_RESPONSE_INSUFFICIENT_RESOURCES", value: 2, type: "integer", description: "Port VDP response insufficient resources" }],
  ["PORT_VDP_RESPONSE_UNUSED_VTID", { name: "PORT_VDP_RESPONSE_UNUSED_VTID", value: 3, type: "integer", description: "Port VDP response unused VTID" }],
  ["PORT_VDP_RESPONSE_VTID_VIOLATION", { name: "PORT_VDP_RESPONSE_VTID_VIOLATION", value: 4, type: "integer", description: "Port VDP response VTID violation" }],
  ["PORT_VDP_RESPONSE_VTID_VERSION_VIOALTION", { name: "PORT_VDP_RESPONSE_VTID_VERSION_VIOALTION", value: 5, type: "integer", description: "Port VDP response VTID version violation" }],
  ["PORT_VDP_RESPONSE_OUT_OF_SYNC", { name: "PORT_VDP_RESPONSE_OUT_OF_SYNC", value: 6, type: "integer", description: "Port VDP response out of sync" }],
  ["PORT_PROFILE_RESPONSE_SUCCESS", { name: "PORT_PROFILE_RESPONSE_SUCCESS", value: 0x100, type: "integer", description: "Port profile response success" }],
  ["PORT_PROFILE_RESPONSE_INPROGRESS", { name: "PORT_PROFILE_RESPONSE_INPROGRESS", value: 0x101, type: "integer", description: "Port profile response in progress" }],
  ["PORT_PROFILE_RESPONSE_INVALID", { name: "PORT_PROFILE_RESPONSE_INVALID", value: 0x102, type: "integer", description: "Port profile response invalid" }],
  ["PORT_PROFILE_RESPONSE_BADSTATE", { name: "PORT_PROFILE_RESPONSE_BADSTATE", value: 0x103, type: "integer", description: "Port profile response bad state" }],
  ["PORT_PROFILE_RESPONSE_INSUFFICIENT_RESOURCES", { name: "PORT_PROFILE_RESPONSE_INSUFFICIENT_RESOURCES", value: 0x104, type: "integer", description: "Port profile response insufficient resources" }],
  ["PORT_PROFILE_RESPONSE_ERROR", { name: "PORT_PROFILE_RESPONSE_ERROR", value: 0x105, type: "integer", description: "Port profile response error" }],

  // IPOIB Mode Constants
  ["IPOIB_MODE_DATAGRAM", { name: "IPOIB_MODE_DATAGRAM", value: 0, type: "integer", description: "IPOIB datagram mode" }],
  ["IPOIB_MODE_CONNECTED", { name: "IPOIB_MODE_CONNECTED", value: 1, type: "integer", description: "IPOIB connected mode" }],

  // HSR Protocol Constants
  ["HSR_PROTOCOL_HSR", { name: "HSR_PROTOCOL_HSR", value: 0, type: "integer", description: "High-availability Seamless Redundancy protocol" }],
  ["HSR_PROTOCOL_PRP", { name: "HSR_PROTOCOL_PRP", value: 1, type: "integer", description: "Parallel Redundancy Protocol" }],

  // Link Extended Statistics Type Constants
  ["LINK_XSTATS_TYPE_UNSPEC", { name: "LINK_XSTATS_TYPE_UNSPEC", value: 0, type: "integer", description: "Unspecified link extended statistics type" }],
  ["LINK_XSTATS_TYPE_BRIDGE", { name: "LINK_XSTATS_TYPE_BRIDGE", value: 1, type: "integer", description: "Bridge link extended statistics type" }],
  ["LINK_XSTATS_TYPE_BOND", { name: "LINK_XSTATS_TYPE_BOND", value: 2, type: "integer", description: "Bond link extended statistics type" }],

  // XDP Attachment Constants
  ["XDP_ATTACHED_NONE", { name: "XDP_ATTACHED_NONE", value: 0, type: "integer", description: "No XDP program attached" }],
  ["XDP_ATTACHED_DRV", { name: "XDP_ATTACHED_DRV", value: 1, type: "integer", description: "XDP program attached to driver" }],
  ["XDP_ATTACHED_SKB", { name: "XDP_ATTACHED_SKB", value: 2, type: "integer", description: "XDP program attached to socket buffer" }],
  ["XDP_ATTACHED_HW", { name: "XDP_ATTACHED_HW", value: 3, type: "integer", description: "XDP program attached to hardware" }],
  ["XDP_ATTACHED_MULTI", { name: "XDP_ATTACHED_MULTI", value: 4, type: "integer", description: "Multiple XDP programs attached" }],

  // FDB Notify Constants
  ["FDB_NOTIFY_BIT", { name: "FDB_NOTIFY_BIT", value: 1, type: "integer", description: "FDB notify bit" }],
  ["FDB_NOTIFY_INACTIVE_BIT", { name: "FDB_NOTIFY_INACTIVE_BIT", value: 2, type: "integer", description: "FDB notify inactive bit" }],



  // Route Attribute Constants (for RTAX_LOCK construction)
  ["RTAX_MTU", { name: "RTAX_MTU", value: 2, type: "integer", description: "Route attribute MTU" }],
  ["RTAX_HOPLIMIT", { name: "RTAX_HOPLIMIT", value: 10, type: "integer", description: "Route attribute hop limit" }],
  ["RTAX_ADVMSS", { name: "RTAX_ADVMSS", value: 8, type: "integer", description: "Route attribute advertised MSS" }],
  ["RTAX_REORDERING", { name: "RTAX_REORDERING", value: 9, type: "integer", description: "Route attribute reordering" }],
  ["RTAX_RTT", { name: "RTAX_RTT", value: 4, type: "integer", description: "Route attribute round trip time" }],
  ["RTAX_WINDOW", { name: "RTAX_WINDOW", value: 3, type: "integer", description: "Route attribute window" }],
  ["RTAX_CWND", { name: "RTAX_CWND", value: 7, type: "integer", description: "Route attribute congestion window" }],
  ["RTAX_INITCWND", { name: "RTAX_INITCWND", value: 11, type: "integer", description: "Route attribute initial congestion window" }],
  ["RTAX_INITRWND", { name: "RTAX_INITRWND", value: 14, type: "integer", description: "Route attribute initial receive window" }],
  ["RTAX_FEATURES", { name: "RTAX_FEATURES", value: 12, type: "integer", description: "Route attribute features" }],
  ["RTAX_QUICKACK", { name: "RTAX_QUICKACK", value: 15, type: "integer", description: "Route attribute quick ACK" }],
  ["RTAX_CC_ALGO", { name: "RTAX_CC_ALGO", value: 16, type: "integer", description: "Route attribute congestion control algorithm" }],
  ["RTAX_RTTVAR", { name: "RTAX_RTTVAR", value: 5, type: "integer", description: "Route attribute RTT variance" }],
  ["RTAX_SSTHRESH", { name: "RTAX_SSTHRESH", value: 6, type: "integer", description: "Route attribute slow start threshold" }],
  ["RTAX_FASTOPEN_NO_COOKIE", { name: "RTAX_FASTOPEN_NO_COOKIE", value: 17, type: "integer", description: "Route attribute fast open no cookie" }],

  // Prefix Constants
  ["PREFIX_UNSPEC", { name: "PREFIX_UNSPEC", value: 0, type: "integer", description: "Unspecified prefix" }],
  ["PREFIX_ADDRESS", { name: "PREFIX_ADDRESS", value: 1, type: "integer", description: "Prefix address" }],
  ["PREFIX_CACHEINFO", { name: "PREFIX_CACHEINFO", value: 2, type: "integer", description: "Prefix cache information" }],

  // Neighbor Discovery User Option Constants
  ["NDUSEROPT_UNSPEC", { name: "NDUSEROPT_UNSPEC", value: 0, type: "integer", description: "Unspecified neighbor discovery user option" }],
  ["NDUSEROPT_SRCADDR", { name: "NDUSEROPT_SRCADDR", value: 1, type: "integer", description: "Neighbor discovery source address option" }],

  // GRE Constants
  ["GRE_CSUM", { name: "GRE_CSUM", value: "GRE_CSUM", type: "integer", description: "GRE checksum flag" }],
  ["GRE_ROUTING", { name: "GRE_ROUTING", value: "GRE_ROUTING", type: "integer", description: "GRE routing flag" }],
  ["GRE_KEY", { name: "GRE_KEY", value: "GRE_KEY", type: "integer", description: "GRE key flag" }],
  ["GRE_SEQ", { name: "GRE_SEQ", value: "GRE_SEQ", type: "integer", description: "GRE sequence flag" }],
  ["GRE_STRICT", { name: "GRE_STRICT", value: "GRE_STRICT", type: "integer", description: "GRE strict flag" }],
  ["GRE_REC", { name: "GRE_REC", value: "GRE_REC", type: "integer", description: "GRE recursion flag" }],
  ["GRE_ACK", { name: "GRE_ACK", value: "GRE_ACK", type: "integer", description: "GRE acknowledgment flag" }],

  // Tunnel Encapsulation Constants
  ["TUNNEL_ENCAP_NONE", { name: "TUNNEL_ENCAP_NONE", value: 0, type: "integer", description: "No tunnel encapsulation" }],
  ["TUNNEL_ENCAP_FOU", { name: "TUNNEL_ENCAP_FOU", value: 1, type: "integer", description: "Foo-over-UDP tunnel encapsulation" }],
  ["TUNNEL_ENCAP_GUE", { name: "TUNNEL_ENCAP_GUE", value: 2, type: "integer", description: "Generic UDP Encapsulation" }],
  ["TUNNEL_ENCAP_MPLS", { name: "TUNNEL_ENCAP_MPLS", value: 3, type: "integer", description: "MPLS tunnel encapsulation" }],

  // Tunnel Encapsulation Flag Constants
  ["TUNNEL_ENCAP_FLAG_CSUM", { name: "TUNNEL_ENCAP_FLAG_CSUM", value: 1, type: "integer", description: "Tunnel encapsulation checksum flag" }],
  ["TUNNEL_ENCAP_FLAG_CSUM6", { name: "TUNNEL_ENCAP_FLAG_CSUM6", value: 2, type: "integer", description: "Tunnel encapsulation IPv6 checksum flag" }],
  ["TUNNEL_ENCAP_FLAG_REMCSUM", { name: "TUNNEL_ENCAP_FLAG_REMCSUM", value: 4, type: "integer", description: "Tunnel encapsulation remote checksum flag" }],

  // IPv6 Tunnel Flag Constants
  ["IP6_TNL_F_ALLOW_LOCAL_REMOTE", { name: "IP6_TNL_F_ALLOW_LOCAL_REMOTE", value: 0x40, type: "integer", description: "IPv6 tunnel allow local remote flag" }],
  ["IP6_TNL_F_IGN_ENCAP_LIMIT", { name: "IP6_TNL_F_IGN_ENCAP_LIMIT", value: 0x1, type: "integer", description: "IPv6 tunnel ignore encapsulation limit flag" }],
  ["IP6_TNL_F_MIP6_DEV", { name: "IP6_TNL_F_MIP6_DEV", value: 0x8, type: "integer", description: "IPv6 tunnel Mobile IPv6 device flag" }],
  ["IP6_TNL_F_RCV_DSCP_COPY", { name: "IP6_TNL_F_RCV_DSCP_COPY", value: 0x10, type: "integer", description: "IPv6 tunnel receive DSCP copy flag" }],
  ["IP6_TNL_F_USE_ORIG_FLOWLABEL", { name: "IP6_TNL_F_USE_ORIG_FLOWLABEL", value: 0x4, type: "integer", description: "IPv6 tunnel use original flow label flag" }],
  ["IP6_TNL_F_USE_ORIG_FWMARK", { name: "IP6_TNL_F_USE_ORIG_FWMARK", value: 0x20, type: "integer", description: "IPv6 tunnel use original firewall mark flag" }],
  ["IP6_TNL_F_USE_ORIG_TCLASS", { name: "IP6_TNL_F_USE_ORIG_TCLASS", value: 0x2, type: "integer", description: "IPv6 tunnel use original traffic class flag" }],

  // Neighbor Table Flag Constants
  ["NTF_EXT_LEARNED", { name: "NTF_EXT_LEARNED", value: 0x10, type: "integer", description: "Neighbor table external learned flag" }],
  ["NTF_MASTER", { name: "NTF_MASTER", value: 0x04, type: "integer", description: "Neighbor table master flag" }],
  ["NTF_OFFLOADED", { name: "NTF_OFFLOADED", value: 0x20, type: "integer", description: "Neighbor table offloaded flag" }],
  ["NTF_PROXY", { name: "NTF_PROXY", value: 0x08, type: "integer", description: "Neighbor table proxy flag" }],
  ["NTF_ROUTER", { name: "NTF_ROUTER", value: 0x80, type: "integer", description: "Neighbor table router flag" }],
  ["NTF_SELF", { name: "NTF_SELF", value: 0x02, type: "integer", description: "Neighbor table self flag" }],
  ["NTF_STICKY", { name: "NTF_STICKY", value: 0x40, type: "integer", description: "Neighbor table sticky flag" }],
  ["NTF_USE", { name: "NTF_USE", value: 0x01, type: "integer", description: "Neighbor table use flag" }],

  // Neighbor Unreachability Detection Constants
  ["NUD_DELAY", { name: "NUD_DELAY", value: 0x08, type: "integer", description: "Neighbor unreachability detection delay state" }],
  ["NUD_FAILED", { name: "NUD_FAILED", value: 0x20, type: "integer", description: "Neighbor unreachability detection failed state" }],
  ["NUD_INCOMPLETE", { name: "NUD_INCOMPLETE", value: 0x01, type: "integer", description: "Neighbor unreachability detection incomplete state" }],
  ["NUD_NOARP", { name: "NUD_NOARP", value: 0x40, type: "integer", description: "Neighbor unreachability detection no ARP state" }],
  ["NUD_NONE", { name: "NUD_NONE", value: 0x00, type: "integer", description: "Neighbor unreachability detection none state" }],
  ["NUD_PERMANENT", { name: "NUD_PERMANENT", value: 0x80, type: "integer", description: "Neighbor unreachability detection permanent state" }],
  ["NUD_PROBE", { name: "NUD_PROBE", value: 0x10, type: "integer", description: "Neighbor unreachability detection probe state" }],
  ["NUD_REACHABLE", { name: "NUD_REACHABLE", value: 0x02, type: "integer", description: "Neighbor unreachability detection reachable state" }],
  ["NUD_STALE", { name: "NUD_STALE", value: 0x04, type: "integer", description: "Neighbor unreachability detection stale state" }],

  // Interface Address Flag Constants
  ["IFA_F_DADFAILED", { name: "IFA_F_DADFAILED", value: 0x08, type: "integer", description: "Interface address DAD failed flag" }],
  ["IFA_F_DEPRECATED", { name: "IFA_F_DEPRECATED", value: 0x20, type: "integer", description: "Interface address deprecated flag" }],
  ["IFA_F_HOMEADDRESS", { name: "IFA_F_HOMEADDRESS", value: 0x10, type: "integer", description: "Interface address home address flag" }],
  ["IFA_F_MANAGETEMPADDR", { name: "IFA_F_MANAGETEMPADDR", value: 0x100, type: "integer", description: "Interface address manage temporary address flag" }],
  ["IFA_F_MCAUTOJOIN", { name: "IFA_F_MCAUTOJOIN", value: 0x400, type: "integer", description: "Interface address multicast auto join flag" }],
  ["IFA_F_NODAD", { name: "IFA_F_NODAD", value: 0x02, type: "integer", description: "Interface address no DAD flag" }],
  ["IFA_F_NOPREFIXROUTE", { name: "IFA_F_NOPREFIXROUTE", value: 0x200, type: "integer", description: "Interface address no prefix route flag" }],
  ["IFA_F_OPTIMISTIC", { name: "IFA_F_OPTIMISTIC", value: 0x04, type: "integer", description: "Interface address optimistic flag" }],
  ["IFA_F_PERMANENT", { name: "IFA_F_PERMANENT", value: 0x80, type: "integer", description: "Interface address permanent flag" }],
  ["IFA_F_SECONDARY", { name: "IFA_F_SECONDARY", value: 0x01, type: "integer", description: "Interface address secondary flag" }],
  ["IFA_F_STABLE_PRIVACY", { name: "IFA_F_STABLE_PRIVACY", value: 0x800, type: "integer", description: "Interface address stable privacy flag" }],
  ["IFA_F_TEMPORARY", { name: "IFA_F_TEMPORARY", value: 0x01, type: "integer", description: "Interface address temporary flag (alias for SECONDARY)" }],
  ["IFA_F_TENTATIVE", { name: "IFA_F_TENTATIVE", value: 0x40, type: "integer", description: "Interface address tentative flag" }],

  // FIB Rule Flag Constants
  ["FIB_RULE_PERMANENT", { name: "FIB_RULE_PERMANENT", value: 0x00000001, type: "integer", description: "FIB rule permanent flag" }],
  ["FIB_RULE_INVERT", { name: "FIB_RULE_INVERT", value: 0x00000002, type: "integer", description: "FIB rule invert flag" }],
  ["FIB_RULE_UNRESOLVED", { name: "FIB_RULE_UNRESOLVED", value: 0x00000004, type: "integer", description: "FIB rule unresolved flag" }],
  ["FIB_RULE_IIF_DETACHED", { name: "FIB_RULE_IIF_DETACHED", value: 0x00000008, type: "integer", description: "FIB rule input interface detached flag" }],
  ["FIB_RULE_DEV_DETACHED", { name: "FIB_RULE_DEV_DETACHED", value: 0x00000008, type: "integer", description: "FIB rule device detached flag" }],
  ["FIB_RULE_OIF_DETACHED", { name: "FIB_RULE_OIF_DETACHED", value: 0x00000010, type: "integer", description: "FIB rule output interface detached flag" }],

  // FIB Rule Action Constants
  ["FR_ACT_TO_TBL", { name: "FR_ACT_TO_TBL", value: 1, type: "integer", description: "FIB rule action to table" }],
  ["FR_ACT_GOTO", { name: "FR_ACT_GOTO", value: 2, type: "integer", description: "FIB rule action goto" }],
  ["FR_ACT_NOP", { name: "FR_ACT_NOP", value: 3, type: "integer", description: "FIB rule action no operation" }],
  ["FR_ACT_BLACKHOLE", { name: "FR_ACT_BLACKHOLE", value: 6, type: "integer", description: "FIB rule action blackhole" }],
  ["FR_ACT_UNREACHABLE", { name: "FR_ACT_UNREACHABLE", value: 7, type: "integer", description: "FIB rule action unreachable" }],
  ["FR_ACT_PROHIBIT", { name: "FR_ACT_PROHIBIT", value: 8, type: "integer", description: "FIB rule action prohibit" }],

  // Network Configuration Constants
  ["NETCONFA_IFINDEX_ALL", { name: "NETCONFA_IFINDEX_ALL", value: -1, type: "integer", description: "Network configuration all interfaces index" }],
  ["NETCONFA_IFINDEX_DEFAULT", { name: "NETCONFA_IFINDEX_DEFAULT", value: -2, type: "integer", description: "Network configuration default interface index" }],

  // Bridge Flag Constants
  ["BRIDGE_FLAGS_MASTER", { name: "BRIDGE_FLAGS_MASTER", value: 1, type: "integer", description: "Bridge flags master" }],
  ["BRIDGE_FLAGS_SELF", { name: "BRIDGE_FLAGS_SELF", value: 2, type: "integer", description: "Bridge flags self" }],

  // Bridge Mode Constants (Additional)
  ["BRIDGE_MODE_VEB", { name: "BRIDGE_MODE_VEB", value: 0, type: "integer", description: "Bridge mode Virtual Ethernet Bridge" }],
  ["BRIDGE_MODE_VEPA", { name: "BRIDGE_MODE_VEPA", value: 1, type: "integer", description: "Bridge mode Virtual Ethernet Port Aggregator" }],
  ["BRIDGE_MODE_UNDEF", { name: "BRIDGE_MODE_UNDEF", value: 0xFFFF, type: "integer", description: "Bridge mode undefined" }],

  // Bridge VLAN Info Constants
  ["BRIDGE_VLAN_INFO_MASTER", { name: "BRIDGE_VLAN_INFO_MASTER", value: 1, type: "integer", description: "Bridge VLAN info master flag" }],
  ["BRIDGE_VLAN_INFO_PVID", { name: "BRIDGE_VLAN_INFO_PVID", value: 2, type: "integer", description: "Bridge VLAN info PVID flag" }],
  ["BRIDGE_VLAN_INFO_UNTAGGED", { name: "BRIDGE_VLAN_INFO_UNTAGGED", value: 4, type: "integer", description: "Bridge VLAN info untagged flag" }],
  ["BRIDGE_VLAN_INFO_RANGE_BEGIN", { name: "BRIDGE_VLAN_INFO_RANGE_BEGIN", value: 8, type: "integer", description: "Bridge VLAN info range begin flag" }],
  ["BRIDGE_VLAN_INFO_RANGE_END", { name: "BRIDGE_VLAN_INFO_RANGE_END", value: 16, type: "integer", description: "Bridge VLAN info range end flag" }],
  ["BRIDGE_VLAN_INFO_BRENTRY", { name: "BRIDGE_VLAN_INFO_BRENTRY", value: 32, type: "integer", description: "Bridge VLAN info bridge entry flag" }],

  // WiFi Interface Types (keeping existing ones for backward compatibility)
  ["NL80211_IFTYPE_ADHOC", { name: "NL80211_IFTYPE_ADHOC", value: 1, type: "integer", description: "Ad-hoc network interface type" }],
  ["NL80211_IFTYPE_STATION", { name: "NL80211_IFTYPE_STATION", value: 2, type: "integer", description: "Station (client) interface type" }],
  ["NL80211_IFTYPE_AP", { name: "NL80211_IFTYPE_AP", value: 3, type: "integer", description: "Access Point interface type" }],
  ["NL80211_IFTYPE_AP_VLAN", { name: "NL80211_IFTYPE_AP_VLAN", value: 4, type: "integer", description: "Access Point VLAN interface type" }],
  ["NL80211_IFTYPE_WDS", { name: "NL80211_IFTYPE_WDS", value: 5, type: "integer", description: "Wireless Distribution System interface type" }],
  ["NL80211_IFTYPE_MONITOR", { name: "NL80211_IFTYPE_MONITOR", value: 6, type: "integer", description: "Monitor interface type (packet capture)" }],
  ["NL80211_IFTYPE_MESH_POINT", { name: "NL80211_IFTYPE_MESH_POINT", value: 7, type: "integer", description: "Mesh point interface type" }],
  ["NL80211_IFTYPE_P2P_CLIENT", { name: "NL80211_IFTYPE_P2P_CLIENT", value: 8, type: "integer", description: "P2P client interface type" }],
  ["NL80211_IFTYPE_P2P_GO", { name: "NL80211_IFTYPE_P2P_GO", value: 9, type: "integer", description: "P2P Group Owner interface type" }],
  ["NL80211_IFTYPE_P2P_DEVICE", { name: "NL80211_IFTYPE_P2P_DEVICE", value: 10, type: "integer", description: "P2P device interface type" }],
  ["NL80211_IFTYPE_OCB", { name: "NL80211_IFTYPE_OCB", value: 11, type: "integer", description: "Outside Context of a BSS interface type" }],

  // Common NL80211 Commands (keeping existing ones for backward compatibility)
  ["NL80211_CMD_GET_WIPHY", { name: "NL80211_CMD_GET_WIPHY", value: 1, type: "integer", description: "Get wireless physical device information" }],
  ["NL80211_CMD_SET_WIPHY", { name: "NL80211_CMD_SET_WIPHY", value: 2, type: "integer", description: "Set wireless physical device configuration" }],
  ["NL80211_CMD_NEW_WIPHY", { name: "NL80211_CMD_NEW_WIPHY", value: 3, type: "integer", description: "Create new wireless physical device" }],
  ["NL80211_CMD_DEL_WIPHY", { name: "NL80211_CMD_DEL_WIPHY", value: 4, type: "integer", description: "Delete wireless physical device" }],
  ["NL80211_CMD_GET_INTERFACE", { name: "NL80211_CMD_GET_INTERFACE", value: 5, type: "integer", description: "Get wireless interface information" }],
  ["NL80211_CMD_SET_INTERFACE", { name: "NL80211_CMD_SET_INTERFACE", value: 6, type: "integer", description: "Set wireless interface configuration" }],
  ["NL80211_CMD_NEW_INTERFACE", { name: "NL80211_CMD_NEW_INTERFACE", value: 7, type: "integer", description: "Create new wireless interface" }],
  ["NL80211_CMD_DEL_INTERFACE", { name: "NL80211_CMD_DEL_INTERFACE", value: 8, type: "integer", description: "Delete wireless interface" }],
  ["NL80211_CMD_GET_STATION", { name: "NL80211_CMD_GET_STATION", value: 17, type: "integer", description: "Get station information" }],
  ["NL80211_CMD_SET_STATION", { name: "NL80211_CMD_SET_STATION", value: 18, type: "integer", description: "Set station configuration" }],
  ["NL80211_CMD_NEW_STATION", { name: "NL80211_CMD_NEW_STATION", value: 19, type: "integer", description: "Create new station" }],
  ["NL80211_CMD_DEL_STATION", { name: "NL80211_CMD_DEL_STATION", value: 20, type: "integer", description: "Delete station" }],
  ["NL80211_CMD_GET_SCAN", { name: "NL80211_CMD_GET_SCAN", value: 32, type: "integer", description: "Get scan results" }],
  ["NL80211_CMD_TRIGGER_SCAN", { name: "NL80211_CMD_TRIGGER_SCAN", value: 33, type: "integer", description: "Trigger a scan" }],
  ["NL80211_CMD_CONNECT", { name: "NL80211_CMD_CONNECT", value: 46, type: "integer", description: "Connect to an access point" }],
  ["NL80211_CMD_DISCONNECT", { name: "NL80211_CMD_DISCONNECT", value: 48, type: "integer", description: "Disconnect from an access point" }],
  ["NL80211_CMD_START_AP", { name: "NL80211_CMD_START_AP", value: 15, type: "integer", description: "Start access point mode" }],
  ["NL80211_CMD_STOP_AP", { name: "NL80211_CMD_STOP_AP", value: 16, type: "integer", description: "Stop access point mode" }],

  // Hardware Simulator Commands (keeping existing ones for backward compatibility)
  ["HWSIM_CMD_REGISTER", { name: "HWSIM_CMD_REGISTER", value: 1, type: "integer", description: "Register with the wireless hardware simulator" }],
  ["HWSIM_CMD_FRAME", { name: "HWSIM_CMD_FRAME", value: 2, type: "integer", description: "Send a frame through the hardware simulator" }],
  ["HWSIM_CMD_TX_INFO_FRAME", { name: "HWSIM_CMD_TX_INFO_FRAME", value: 3, type: "integer", description: "Send transmission info frame" }],
  ["HWSIM_CMD_NEW_RADIO", { name: "HWSIM_CMD_NEW_RADIO", value: 4, type: "integer", description: "Create new simulated radio" }],
  ["HWSIM_CMD_DEL_RADIO", { name: "HWSIM_CMD_DEL_RADIO", value: 5, type: "integer", description: "Delete simulated radio" }],
  ["HWSIM_CMD_GET_RADIO", { name: "HWSIM_CMD_GET_RADIO", value: 6, type: "integer", description: "Get simulated radio information" }]
]);

export class Nl80211TypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(nl80211Functions.keys());
  }

  getFunction(name: string): Nl80211FunctionSignature | undefined {
    return nl80211Functions.get(name);
  }

  isNl80211Function(name: string): boolean {
    return nl80211Functions.has(name);
  }

  getConstantNames(): string[] {
    return Array.from(nl80211Constants.keys());
  }

  getConstant(name: string): Nl80211ConstantSignature | undefined {
    return nl80211Constants.get(name);
  }

  isNl80211Constant(name: string): boolean {
    return nl80211Constants.has(name);
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
      doc += '**Example:**\n```ucode\n// Get all wireless interfaces\nlet result = request(NL80211_CMD_GET_INTERFACE, NLM_F_DUMP);\n```';
    } else if (name === 'waitfor') {
      doc += '**Example:**\n```ucode\n// Wait for scan results with 10 second timeout\nlet msg = waitfor([NL80211_CMD_NEW_SCAN_RESULTS], 10000);\n```';
    } else if (name === 'listener') {
      doc += '**Example:**\n```ucode\n// Listen for station events\nlet l = listener(function(msg) {\n  printf("Station event: %J\\n", msg);\n}, [NL80211_CMD_NEW_STATION, NL80211_CMD_DEL_STATION]);\n```';
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
    return this.isNl80211Function(name) || this.isNl80211Constant(name);
  }

  getValidImports(): string[] {
    return [...this.getFunctionNames(), ...this.getConstantNames(), 'const'];
  }

  isValidNl80211Import(name: string): boolean {
    return this.getValidImports().includes(name);
  }
}

export const nl80211TypeRegistry = new Nl80211TypeRegistry();

// ============================================================================
// NL80211 Listener Object Type (similar to fs objects)
// ============================================================================

export enum Nl80211ObjectType {
  NL80211_LISTENER = 'nl80211.listener'
}

export interface Nl80211ObjectDefinition {
  type: Nl80211ObjectType;
  methods: Map<string, Nl80211FunctionSignature>;
}

export interface Nl80211MethodSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  returnType: string;
  description: string;
}

export class Nl80211ObjectRegistry {
  private static instance: Nl80211ObjectRegistry;
  private types: Map<Nl80211ObjectType, Nl80211ObjectDefinition> = new Map();

  private constructor() {
    this.initializeNl80211ListenerType();
  }

  public static getInstance(): Nl80211ObjectRegistry {
    if (!Nl80211ObjectRegistry.instance) {
      Nl80211ObjectRegistry.instance = new Nl80211ObjectRegistry();
    }
    return Nl80211ObjectRegistry.instance;
  }

  private initializeNl80211ListenerType(): void {
    const listenerMethods = new Map<string, Nl80211FunctionSignature>([
      ['set_commands', {
        name: 'set_commands',
        parameters: [
          { name: 'cmds', type: 'array', optional: false }
        ],
        returnType: 'null',
        description: 'Set the commands that this listener should monitor. Takes an array of NL80211_CMD_* constants.'
      }],
      ['close', {
        name: 'close',
        parameters: [],
        returnType: 'null',
        description: 'Close the listener and stop monitoring nl80211 events.'
      }]
    ]);

    this.types.set(Nl80211ObjectType.NL80211_LISTENER, {
      type: Nl80211ObjectType.NL80211_LISTENER,
      methods: listenerMethods
    });
  }

  public getNl80211Type(typeName: string): Nl80211ObjectDefinition | undefined {
    return this.types.get(typeName as Nl80211ObjectType);
  }

  public isNl80211Type(typeName: string): boolean {
    return this.types.has(typeName as Nl80211ObjectType);
  }

  public getNl80211Method(typeName: string, methodName: string): Nl80211FunctionSignature | undefined {
    const nl80211Type = this.getNl80211Type(typeName);
    return nl80211Type?.methods.get(methodName);
  }

  public getMethodsForType(typeName: string): string[] {
    const nl80211Type = this.getNl80211Type(typeName);
    return nl80211Type ? Array.from(nl80211Type.methods.keys()) : [];
  }

  // Check if a variable type represents an nl80211 object
  public isVariableOfNl80211Type(dataType: any): Nl80211ObjectType | null {
    if (typeof dataType === 'string') {
      return null;
    }
    
    // Check if it's a module type with nl80211 object type name
    if ('moduleName' in dataType && typeof dataType.moduleName === 'string') {
      const moduleName = dataType.moduleName;
      if (this.isNl80211Type(moduleName)) {
        return moduleName as Nl80211ObjectType;
      }
    }

    return null;
  }
}

// Singleton instance
export const nl80211ObjectRegistry = Nl80211ObjectRegistry.getInstance();

// Helper functions for type checking
export function isNl80211ObjectType(typeName: string): typeName is Nl80211ObjectType {
  return Object.values(Nl80211ObjectType).includes(typeName as Nl80211ObjectType);
}

export function createNl80211ObjectDataType(nl80211Type: Nl80211ObjectType): any {
  return {
    type: 'object',
    moduleName: nl80211Type
  };
}