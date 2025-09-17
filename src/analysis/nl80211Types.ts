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

  // WiFi Interface Types - Complete list from enum nl80211_iftype
  ["NL80211_IFTYPE_UNSPECIFIED", { name: "NL80211_IFTYPE_UNSPECIFIED", value: 0, type: "integer", description: "Unspecified interface type" }],
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
  ["NL80211_IFTYPE_NAN", { name: "NL80211_IFTYPE_NAN", value: 12, type: "integer", description: "Neighbor Awareness Networking interface type" }],

  // NL80211 Command Constants - Complete list from enum nl80211_commands
  ["NL80211_CMD_UNSPEC", { name: "NL80211_CMD_UNSPEC", value: 0, type: "integer", description: "Unspecified command" }],
  ["NL80211_CMD_GET_WIPHY", { name: "NL80211_CMD_GET_WIPHY", value: 1, type: "integer", description: "Get wireless physical device information" }],
  ["NL80211_CMD_SET_WIPHY", { name: "NL80211_CMD_SET_WIPHY", value: 2, type: "integer", description: "Set wireless physical device configuration" }],
  ["NL80211_CMD_NEW_WIPHY", { name: "NL80211_CMD_NEW_WIPHY", value: 3, type: "integer", description: "Create new wireless physical device" }],
  ["NL80211_CMD_DEL_WIPHY", { name: "NL80211_CMD_DEL_WIPHY", value: 4, type: "integer", description: "Delete wireless physical device" }],
  ["NL80211_CMD_GET_INTERFACE", { name: "NL80211_CMD_GET_INTERFACE", value: 5, type: "integer", description: "Get wireless interface information" }],
  ["NL80211_CMD_SET_INTERFACE", { name: "NL80211_CMD_SET_INTERFACE", value: 6, type: "integer", description: "Set wireless interface configuration" }],
  ["NL80211_CMD_NEW_INTERFACE", { name: "NL80211_CMD_NEW_INTERFACE", value: 7, type: "integer", description: "Create new wireless interface" }],
  ["NL80211_CMD_DEL_INTERFACE", { name: "NL80211_CMD_DEL_INTERFACE", value: 8, type: "integer", description: "Delete wireless interface" }],
  ["NL80211_CMD_GET_KEY", { name: "NL80211_CMD_GET_KEY", value: 9, type: "integer", description: "Get encryption key" }],
  ["NL80211_CMD_SET_KEY", { name: "NL80211_CMD_SET_KEY", value: 10, type: "integer", description: "Set encryption key" }],
  ["NL80211_CMD_NEW_KEY", { name: "NL80211_CMD_NEW_KEY", value: 11, type: "integer", description: "Create new encryption key" }],
  ["NL80211_CMD_DEL_KEY", { name: "NL80211_CMD_DEL_KEY", value: 12, type: "integer", description: "Delete encryption key" }],
  ["NL80211_CMD_GET_BEACON", { name: "NL80211_CMD_GET_BEACON", value: 13, type: "integer", description: "Get beacon configuration" }],
  ["NL80211_CMD_SET_BEACON", { name: "NL80211_CMD_SET_BEACON", value: 14, type: "integer", description: "Set beacon configuration" }],
  ["NL80211_CMD_START_AP", { name: "NL80211_CMD_START_AP", value: 15, type: "integer", description: "Start access point mode" }],
  ["NL80211_CMD_NEW_BEACON", { name: "NL80211_CMD_NEW_BEACON", value: 15, type: "integer", description: "Start new beacon (alias for START_AP)" }],
  ["NL80211_CMD_STOP_AP", { name: "NL80211_CMD_STOP_AP", value: 16, type: "integer", description: "Stop access point mode" }],
  ["NL80211_CMD_DEL_BEACON", { name: "NL80211_CMD_DEL_BEACON", value: 16, type: "integer", description: "Delete beacon (alias for STOP_AP)" }],
  ["NL80211_CMD_GET_STATION", { name: "NL80211_CMD_GET_STATION", value: 17, type: "integer", description: "Get station information" }],
  ["NL80211_CMD_SET_STATION", { name: "NL80211_CMD_SET_STATION", value: 18, type: "integer", description: "Set station configuration" }],
  ["NL80211_CMD_NEW_STATION", { name: "NL80211_CMD_NEW_STATION", value: 19, type: "integer", description: "Create new station" }],
  ["NL80211_CMD_DEL_STATION", { name: "NL80211_CMD_DEL_STATION", value: 20, type: "integer", description: "Delete station" }],
  ["NL80211_CMD_GET_MPATH", { name: "NL80211_CMD_GET_MPATH", value: 21, type: "integer", description: "Get mesh path information" }],
  ["NL80211_CMD_SET_MPATH", { name: "NL80211_CMD_SET_MPATH", value: 22, type: "integer", description: "Set mesh path configuration" }],
  ["NL80211_CMD_NEW_MPATH", { name: "NL80211_CMD_NEW_MPATH", value: 23, type: "integer", description: "Create new mesh path" }],
  ["NL80211_CMD_DEL_MPATH", { name: "NL80211_CMD_DEL_MPATH", value: 24, type: "integer", description: "Delete mesh path" }],
  ["NL80211_CMD_SET_BSS", { name: "NL80211_CMD_SET_BSS", value: 25, type: "integer", description: "Set BSS configuration" }],
  ["NL80211_CMD_SET_REG", { name: "NL80211_CMD_SET_REG", value: 26, type: "integer", description: "Set regulatory domain" }],
  ["NL80211_CMD_REQ_SET_REG", { name: "NL80211_CMD_REQ_SET_REG", value: 27, type: "integer", description: "Request to set regulatory domain" }],
  ["NL80211_CMD_GET_MESH_CONFIG", { name: "NL80211_CMD_GET_MESH_CONFIG", value: 28, type: "integer", description: "Get mesh configuration" }],
  ["NL80211_CMD_SET_MESH_CONFIG", { name: "NL80211_CMD_SET_MESH_CONFIG", value: 29, type: "integer", description: "Set mesh configuration" }],
  ["NL80211_CMD_SET_MGMT_EXTRA_IE", { name: "NL80211_CMD_SET_MGMT_EXTRA_IE", value: 30, type: "integer", description: "Set extra IE for management frames" }],
  ["NL80211_CMD_GET_REG", { name: "NL80211_CMD_GET_REG", value: 31, type: "integer", description: "Get regulatory domain" }],
  ["NL80211_CMD_GET_SCAN", { name: "NL80211_CMD_GET_SCAN", value: 32, type: "integer", description: "Get scan results" }],
  ["NL80211_CMD_TRIGGER_SCAN", { name: "NL80211_CMD_TRIGGER_SCAN", value: 33, type: "integer", description: "Trigger a scan" }],
  ["NL80211_CMD_NEW_SCAN_RESULTS", { name: "NL80211_CMD_NEW_SCAN_RESULTS", value: 34, type: "integer", description: "New scan results available" }],
  ["NL80211_CMD_SCAN_ABORTED", { name: "NL80211_CMD_SCAN_ABORTED", value: 35, type: "integer", description: "Scan was aborted" }],
  ["NL80211_CMD_REG_CHANGE", { name: "NL80211_CMD_REG_CHANGE", value: 36, type: "integer", description: "Regulatory domain changed" }],
  ["NL80211_CMD_AUTHENTICATE", { name: "NL80211_CMD_AUTHENTICATE", value: 37, type: "integer", description: "Authenticate with AP" }],
  ["NL80211_CMD_ASSOCIATE", { name: "NL80211_CMD_ASSOCIATE", value: 38, type: "integer", description: "Associate with AP" }],
  ["NL80211_CMD_DEAUTHENTICATE", { name: "NL80211_CMD_DEAUTHENTICATE", value: 39, type: "integer", description: "Deauthenticate from AP" }],
  ["NL80211_CMD_DISASSOCIATE", { name: "NL80211_CMD_DISASSOCIATE", value: 40, type: "integer", description: "Disassociate from AP" }],
  ["NL80211_CMD_MICHAEL_MIC_FAILURE", { name: "NL80211_CMD_MICHAEL_MIC_FAILURE", value: 41, type: "integer", description: "Michael MIC failure detected" }],
  ["NL80211_CMD_REG_BEACON_HINT", { name: "NL80211_CMD_REG_BEACON_HINT", value: 42, type: "integer", description: "Regulatory beacon hint" }],
  ["NL80211_CMD_JOIN_IBSS", { name: "NL80211_CMD_JOIN_IBSS", value: 43, type: "integer", description: "Join IBSS network" }],
  ["NL80211_CMD_LEAVE_IBSS", { name: "NL80211_CMD_LEAVE_IBSS", value: 44, type: "integer", description: "Leave IBSS network" }],
  ["NL80211_CMD_TESTMODE", { name: "NL80211_CMD_TESTMODE", value: 45, type: "integer", description: "Test mode command" }],
  ["NL80211_CMD_CONNECT", { name: "NL80211_CMD_CONNECT", value: 46, type: "integer", description: "Connect to an access point" }],
  ["NL80211_CMD_ROAM", { name: "NL80211_CMD_ROAM", value: 47, type: "integer", description: "Roam to another AP" }],
  ["NL80211_CMD_DISCONNECT", { name: "NL80211_CMD_DISCONNECT", value: 48, type: "integer", description: "Disconnect from an access point" }],
  ["NL80211_CMD_SET_WIPHY_NETNS", { name: "NL80211_CMD_SET_WIPHY_NETNS", value: 49, type: "integer", description: "Set wireless physical device network namespace" }],
  ["NL80211_CMD_GET_SURVEY", { name: "NL80211_CMD_GET_SURVEY", value: 50, type: "integer", description: "Get survey information" }],
  ["NL80211_CMD_NEW_SURVEY_RESULTS", { name: "NL80211_CMD_NEW_SURVEY_RESULTS", value: 51, type: "integer", description: "New survey results available" }],
  ["NL80211_CMD_SET_PMKSA", { name: "NL80211_CMD_SET_PMKSA", value: 52, type: "integer", description: "Set PMKSA cache entry" }],
  ["NL80211_CMD_DEL_PMKSA", { name: "NL80211_CMD_DEL_PMKSA", value: 53, type: "integer", description: "Delete PMKSA cache entry" }],
  ["NL80211_CMD_FLUSH_PMKSA", { name: "NL80211_CMD_FLUSH_PMKSA", value: 54, type: "integer", description: "Flush PMKSA cache" }],
  ["NL80211_CMD_REMAIN_ON_CHANNEL", { name: "NL80211_CMD_REMAIN_ON_CHANNEL", value: 55, type: "integer", description: "Remain on channel" }],
  ["NL80211_CMD_CANCEL_REMAIN_ON_CHANNEL", { name: "NL80211_CMD_CANCEL_REMAIN_ON_CHANNEL", value: 56, type: "integer", description: "Cancel remain on channel" }],
  ["NL80211_CMD_SET_TX_BITRATE_MASK", { name: "NL80211_CMD_SET_TX_BITRATE_MASK", value: 57, type: "integer", description: "Set TX bitrate mask" }],
  ["NL80211_CMD_REGISTER_FRAME", { name: "NL80211_CMD_REGISTER_FRAME", value: 58, type: "integer", description: "Register for frame reception" }],
  ["NL80211_CMD_REGISTER_ACTION", { name: "NL80211_CMD_REGISTER_ACTION", value: 58, type: "integer", description: "Register for action frame reception (alias)" }],
  ["NL80211_CMD_FRAME", { name: "NL80211_CMD_FRAME", value: 59, type: "integer", description: "Send/receive frame" }],
  ["NL80211_CMD_ACTION", { name: "NL80211_CMD_ACTION", value: 59, type: "integer", description: "Send/receive action frame (alias)" }],
  ["NL80211_CMD_FRAME_TX_STATUS", { name: "NL80211_CMD_FRAME_TX_STATUS", value: 60, type: "integer", description: "Frame TX status" }],
  ["NL80211_CMD_ACTION_TX_STATUS", { name: "NL80211_CMD_ACTION_TX_STATUS", value: 60, type: "integer", description: "Action frame TX status (alias)" }],
  ["NL80211_CMD_SET_POWER_SAVE", { name: "NL80211_CMD_SET_POWER_SAVE", value: 61, type: "integer", description: "Set power save mode" }],
  ["NL80211_CMD_GET_POWER_SAVE", { name: "NL80211_CMD_GET_POWER_SAVE", value: 62, type: "integer", description: "Get power save mode" }],
  ["NL80211_CMD_SET_CQM", { name: "NL80211_CMD_SET_CQM", value: 63, type: "integer", description: "Set connection quality monitor" }],
  ["NL80211_CMD_NOTIFY_CQM", { name: "NL80211_CMD_NOTIFY_CQM", value: 64, type: "integer", description: "Connection quality monitor notification" }],
  ["NL80211_CMD_SET_CHANNEL", { name: "NL80211_CMD_SET_CHANNEL", value: 65, type: "integer", description: "Set channel" }],
  ["NL80211_CMD_SET_WDS_PEER", { name: "NL80211_CMD_SET_WDS_PEER", value: 66, type: "integer", description: "Set WDS peer" }],
  ["NL80211_CMD_FRAME_WAIT_CANCEL", { name: "NL80211_CMD_FRAME_WAIT_CANCEL", value: 67, type: "integer", description: "Cancel frame wait" }],
  ["NL80211_CMD_JOIN_MESH", { name: "NL80211_CMD_JOIN_MESH", value: 68, type: "integer", description: "Join mesh network" }],
  ["NL80211_CMD_LEAVE_MESH", { name: "NL80211_CMD_LEAVE_MESH", value: 69, type: "integer", description: "Leave mesh network" }],
  ["NL80211_CMD_UNPROT_DEAUTHENTICATE", { name: "NL80211_CMD_UNPROT_DEAUTHENTICATE", value: 70, type: "integer", description: "Unprotected deauthenticate" }],
  ["NL80211_CMD_UNPROT_DISASSOCIATE", { name: "NL80211_CMD_UNPROT_DISASSOCIATE", value: 71, type: "integer", description: "Unprotected disassociate" }],
  ["NL80211_CMD_NEW_PEER_CANDIDATE", { name: "NL80211_CMD_NEW_PEER_CANDIDATE", value: 72, type: "integer", description: "New peer candidate" }],
  ["NL80211_CMD_GET_WOWLAN", { name: "NL80211_CMD_GET_WOWLAN", value: 73, type: "integer", description: "Get WoWLAN configuration" }],
  ["NL80211_CMD_SET_WOWLAN", { name: "NL80211_CMD_SET_WOWLAN", value: 74, type: "integer", description: "Set WoWLAN configuration" }],
  ["NL80211_CMD_START_SCHED_SCAN", { name: "NL80211_CMD_START_SCHED_SCAN", value: 75, type: "integer", description: "Start scheduled scan" }],
  ["NL80211_CMD_STOP_SCHED_SCAN", { name: "NL80211_CMD_STOP_SCHED_SCAN", value: 76, type: "integer", description: "Stop scheduled scan" }],
  ["NL80211_CMD_SCHED_SCAN_RESULTS", { name: "NL80211_CMD_SCHED_SCAN_RESULTS", value: 77, type: "integer", description: "Scheduled scan results" }],
  ["NL80211_CMD_SCHED_SCAN_STOPPED", { name: "NL80211_CMD_SCHED_SCAN_STOPPED", value: 78, type: "integer", description: "Scheduled scan stopped" }],
  ["NL80211_CMD_SET_REKEY_OFFLOAD", { name: "NL80211_CMD_SET_REKEY_OFFLOAD", value: 79, type: "integer", description: "Set rekey offload" }],
  ["NL80211_CMD_PMKSA_CANDIDATE", { name: "NL80211_CMD_PMKSA_CANDIDATE", value: 80, type: "integer", description: "PMKSA candidate" }],
  ["NL80211_CMD_TDLS_OPER", { name: "NL80211_CMD_TDLS_OPER", value: 81, type: "integer", description: "TDLS operation" }],
  ["NL80211_CMD_TDLS_MGMT", { name: "NL80211_CMD_TDLS_MGMT", value: 82, type: "integer", description: "TDLS management" }],
  ["NL80211_CMD_UNEXPECTED_FRAME", { name: "NL80211_CMD_UNEXPECTED_FRAME", value: 83, type: "integer", description: "Unexpected frame" }],
  ["NL80211_CMD_PROBE_CLIENT", { name: "NL80211_CMD_PROBE_CLIENT", value: 84, type: "integer", description: "Probe client" }],
  ["NL80211_CMD_REGISTER_BEACONS", { name: "NL80211_CMD_REGISTER_BEACONS", value: 85, type: "integer", description: "Register for beacon reception" }],
  ["NL80211_CMD_UNEXPECTED_4ADDR_FRAME", { name: "NL80211_CMD_UNEXPECTED_4ADDR_FRAME", value: 86, type: "integer", description: "Unexpected 4-address frame" }],
  ["NL80211_CMD_SET_NOACK_MAP", { name: "NL80211_CMD_SET_NOACK_MAP", value: 87, type: "integer", description: "Set no-ack map" }],
  ["NL80211_CMD_CH_SWITCH_NOTIFY", { name: "NL80211_CMD_CH_SWITCH_NOTIFY", value: 88, type: "integer", description: "Channel switch notification" }],
  ["NL80211_CMD_START_P2P_DEVICE", { name: "NL80211_CMD_START_P2P_DEVICE", value: 89, type: "integer", description: "Start P2P device" }],
  ["NL80211_CMD_STOP_P2P_DEVICE", { name: "NL80211_CMD_STOP_P2P_DEVICE", value: 90, type: "integer", description: "Stop P2P device" }],
  ["NL80211_CMD_CONN_FAILED", { name: "NL80211_CMD_CONN_FAILED", value: 91, type: "integer", description: "Connection failed" }],
  ["NL80211_CMD_NEW_SURVEY_RESULTS", { name: "NL80211_CMD_NEW_SURVEY_RESULTS", value: 92, type: "integer", description: "New survey results available (duplicate)" }],
  ["NL80211_CMD_SET_MCAST_RATE", { name: "NL80211_CMD_SET_MCAST_RATE", value: 92, type: "integer", description: "Set multicast rate" }],
  ["NL80211_CMD_SET_MAC_ACL", { name: "NL80211_CMD_SET_MAC_ACL", value: 93, type: "integer", description: "Set MAC ACL" }],
  ["NL80211_CMD_RADAR_DETECT", { name: "NL80211_CMD_RADAR_DETECT", value: 94, type: "integer", description: "Radar detection" }],
  ["NL80211_CMD_GET_PROTOCOL_FEATURES", { name: "NL80211_CMD_GET_PROTOCOL_FEATURES", value: 95, type: "integer", description: "Get protocol features" }],
  ["NL80211_CMD_UPDATE_FT_IES", { name: "NL80211_CMD_UPDATE_FT_IES", value: 96, type: "integer", description: "Update Fast Transition IEs" }],
  ["NL80211_CMD_FT_EVENT", { name: "NL80211_CMD_FT_EVENT", value: 97, type: "integer", description: "Fast Transition event" }],
  ["NL80211_CMD_CRIT_PROTOCOL_START", { name: "NL80211_CMD_CRIT_PROTOCOL_START", value: 98, type: "integer", description: "Start critical protocol" }],
  ["NL80211_CMD_CRIT_PROTOCOL_STOP", { name: "NL80211_CMD_CRIT_PROTOCOL_STOP", value: 99, type: "integer", description: "Stop critical protocol" }],
  ["NL80211_CMD_GET_COALESCE", { name: "NL80211_CMD_GET_COALESCE", value: 100, type: "integer", description: "Get coalesce configuration" }],
  ["NL80211_CMD_SET_COALESCE", { name: "NL80211_CMD_SET_COALESCE", value: 101, type: "integer", description: "Set coalesce configuration" }],
  ["NL80211_CMD_CHANNEL_SWITCH", { name: "NL80211_CMD_CHANNEL_SWITCH", value: 102, type: "integer", description: "Channel switch" }],
  ["NL80211_CMD_VENDOR", { name: "NL80211_CMD_VENDOR", value: 103, type: "integer", description: "Vendor-specific command" }],
  ["NL80211_CMD_SET_QOS_MAP", { name: "NL80211_CMD_SET_QOS_MAP", value: 104, type: "integer", description: "Set QoS map" }],
  ["NL80211_CMD_ADD_TX_TS", { name: "NL80211_CMD_ADD_TX_TS", value: 105, type: "integer", description: "Add TX traffic stream" }],
  ["NL80211_CMD_DEL_TX_TS", { name: "NL80211_CMD_DEL_TX_TS", value: 106, type: "integer", description: "Delete TX traffic stream" }],
  ["NL80211_CMD_GET_MPP", { name: "NL80211_CMD_GET_MPP", value: 107, type: "integer", description: "Get mesh proxy path" }],
  ["NL80211_CMD_JOIN_OCB", { name: "NL80211_CMD_JOIN_OCB", value: 108, type: "integer", description: "Join OCB" }],
  ["NL80211_CMD_LEAVE_OCB", { name: "NL80211_CMD_LEAVE_OCB", value: 109, type: "integer", description: "Leave OCB" }],
  ["NL80211_CMD_CH_SWITCH_STARTED_NOTIFY", { name: "NL80211_CMD_CH_SWITCH_STARTED_NOTIFY", value: 110, type: "integer", description: "Channel switch started notification" }],
  ["NL80211_CMD_TDLS_CHANNEL_SWITCH", { name: "NL80211_CMD_TDLS_CHANNEL_SWITCH", value: 111, type: "integer", description: "TDLS channel switch" }],
  ["NL80211_CMD_TDLS_CANCEL_CHANNEL_SWITCH", { name: "NL80211_CMD_TDLS_CANCEL_CHANNEL_SWITCH", value: 112, type: "integer", description: "Cancel TDLS channel switch" }],
  ["NL80211_CMD_WIPHY_REG_CHANGE", { name: "NL80211_CMD_WIPHY_REG_CHANGE", value: 113, type: "integer", description: "Wiphy regulatory change" }],
  ["NL80211_CMD_ABORT_SCAN", { name: "NL80211_CMD_ABORT_SCAN", value: 114, type: "integer", description: "Abort scan" }],
  ["NL80211_CMD_START_NAN", { name: "NL80211_CMD_START_NAN", value: 115, type: "integer", description: "Start NAN" }],
  ["NL80211_CMD_STOP_NAN", { name: "NL80211_CMD_STOP_NAN", value: 116, type: "integer", description: "Stop NAN" }],
  ["NL80211_CMD_ADD_NAN_FUNCTION", { name: "NL80211_CMD_ADD_NAN_FUNCTION", value: 117, type: "integer", description: "Add NAN function" }],
  ["NL80211_CMD_DEL_NAN_FUNCTION", { name: "NL80211_CMD_DEL_NAN_FUNCTION", value: 118, type: "integer", description: "Delete NAN function" }],
  ["NL80211_CMD_CHANGE_NAN_CONFIG", { name: "NL80211_CMD_CHANGE_NAN_CONFIG", value: 119, type: "integer", description: "Change NAN configuration" }],
  ["NL80211_CMD_NAN_MATCH", { name: "NL80211_CMD_NAN_MATCH", value: 120, type: "integer", description: "NAN match" }],
  ["NL80211_CMD_SET_MULTICAST_TO_UNICAST", { name: "NL80211_CMD_SET_MULTICAST_TO_UNICAST", value: 121, type: "integer", description: "Set multicast to unicast" }],
  ["NL80211_CMD_UPDATE_CONNECT_PARAMS", { name: "NL80211_CMD_UPDATE_CONNECT_PARAMS", value: 122, type: "integer", description: "Update connection parameters" }],
  ["NL80211_CMD_SET_PMK", { name: "NL80211_CMD_SET_PMK", value: 123, type: "integer", description: "Set PMK" }],
  ["NL80211_CMD_DEL_PMK", { name: "NL80211_CMD_DEL_PMK", value: 124, type: "integer", description: "Delete PMK" }],
  ["NL80211_CMD_PORT_AUTHORIZED", { name: "NL80211_CMD_PORT_AUTHORIZED", value: 125, type: "integer", description: "Port authorized" }],
  ["NL80211_CMD_RELOAD_REGDB", { name: "NL80211_CMD_RELOAD_REGDB", value: 126, type: "integer", description: "Reload regulatory database" }],
  ["NL80211_CMD_EXTERNAL_AUTH", { name: "NL80211_CMD_EXTERNAL_AUTH", value: 127, type: "integer", description: "External authentication" }],
  ["NL80211_CMD_STA_OPMODE_CHANGED", { name: "NL80211_CMD_STA_OPMODE_CHANGED", value: 128, type: "integer", description: "Station operating mode changed" }],
  ["NL80211_CMD_CONTROL_PORT_FRAME", { name: "NL80211_CMD_CONTROL_PORT_FRAME", value: 129, type: "integer", description: "Control port frame" }],
  ["NL80211_CMD_GET_FTM_RESPONDER_STATS", { name: "NL80211_CMD_GET_FTM_RESPONDER_STATS", value: 130, type: "integer", description: "Get FTM responder statistics" }],
  ["NL80211_CMD_PEER_MEASUREMENT_START", { name: "NL80211_CMD_PEER_MEASUREMENT_START", value: 131, type: "integer", description: "Start peer measurement" }],
  ["NL80211_CMD_PEER_MEASUREMENT_RESULT", { name: "NL80211_CMD_PEER_MEASUREMENT_RESULT", value: 132, type: "integer", description: "Peer measurement result" }],
  ["NL80211_CMD_PEER_MEASUREMENT_COMPLETE", { name: "NL80211_CMD_PEER_MEASUREMENT_COMPLETE", value: 133, type: "integer", description: "Peer measurement complete" }],
  ["NL80211_CMD_NOTIFY_RADAR", { name: "NL80211_CMD_NOTIFY_RADAR", value: 134, type: "integer", description: "Radar notification" }],
  ["NL80211_CMD_UPDATE_OWE_INFO", { name: "NL80211_CMD_UPDATE_OWE_INFO", value: 135, type: "integer", description: "Update OWE information" }],
  ["NL80211_CMD_PROBE_MESH_LINK", { name: "NL80211_CMD_PROBE_MESH_LINK", value: 136, type: "integer", description: "Probe mesh link" }],
  ["NL80211_CMD_SET_TID_CONFIG", { name: "NL80211_CMD_SET_TID_CONFIG", value: 137, type: "integer", description: "Set TID configuration" }],
  ["NL80211_CMD_UNPROT_BEACON", { name: "NL80211_CMD_UNPROT_BEACON", value: 138, type: "integer", description: "Unprotected beacon" }],
  ["NL80211_CMD_CONTROL_PORT_FRAME_TX_STATUS", { name: "NL80211_CMD_CONTROL_PORT_FRAME_TX_STATUS", value: 139, type: "integer", description: "Control port frame TX status" }],
  ["NL80211_CMD_SET_SAR_SPECS", { name: "NL80211_CMD_SET_SAR_SPECS", value: 140, type: "integer", description: "Set SAR specifications" }],
  ["NL80211_CMD_OBSS_COLOR_COLLISION", { name: "NL80211_CMD_OBSS_COLOR_COLLISION", value: 141, type: "integer", description: "OBSS color collision" }],
  ["NL80211_CMD_COLOR_CHANGE_REQUEST", { name: "NL80211_CMD_COLOR_CHANGE_REQUEST", value: 142, type: "integer", description: "Color change request" }],
  ["NL80211_CMD_COLOR_CHANGE_STARTED", { name: "NL80211_CMD_COLOR_CHANGE_STARTED", value: 143, type: "integer", description: "Color change started" }],
  ["NL80211_CMD_COLOR_CHANGE_ABORTED", { name: "NL80211_CMD_COLOR_CHANGE_ABORTED", value: 144, type: "integer", description: "Color change aborted" }],
  ["NL80211_CMD_COLOR_CHANGE_COMPLETED", { name: "NL80211_CMD_COLOR_CHANGE_COMPLETED", value: 145, type: "integer", description: "Color change completed" }],
  ["NL80211_CMD_SET_FILS_AAD", { name: "NL80211_CMD_SET_FILS_AAD", value: 146, type: "integer", description: "Set FILS AAD" }],
  ["NL80211_CMD_ASSOC_COMEBACK", { name: "NL80211_CMD_ASSOC_COMEBACK", value: 147, type: "integer", description: "Association comeback" }],
  ["NL80211_CMD_ADD_LINK", { name: "NL80211_CMD_ADD_LINK", value: 148, type: "integer", description: "Add link" }],
  ["NL80211_CMD_REMOVE_LINK", { name: "NL80211_CMD_REMOVE_LINK", value: 149, type: "integer", description: "Remove link" }],
  ["NL80211_CMD_ADD_LINK_STA", { name: "NL80211_CMD_ADD_LINK_STA", value: 150, type: "integer", description: "Add link station" }],
  ["NL80211_CMD_MODIFY_LINK_STA", { name: "NL80211_CMD_MODIFY_LINK_STA", value: 151, type: "integer", description: "Modify link station" }],
  ["NL80211_CMD_REMOVE_LINK_STA", { name: "NL80211_CMD_REMOVE_LINK_STA", value: 152, type: "integer", description: "Remove link station" }],
  ["NL80211_CMD_SET_HW_TIMESTAMP", { name: "NL80211_CMD_SET_HW_TIMESTAMP", value: 153, type: "integer", description: "Set hardware timestamp" }],
  ["NL80211_CMD_LINKS_REMOVED", { name: "NL80211_CMD_LINKS_REMOVED", value: 154, type: "integer", description: "Links removed" }],
  ["NL80211_CMD_SET_TID_TO_LINK_MAPPING", { name: "NL80211_CMD_SET_TID_TO_LINK_MAPPING", value: 155, type: "integer", description: "Set TID to link mapping" }],

  // NL80211 Attribute Constants - Complete list from enum nl80211_attrs
  ["NL80211_ATTR_UNSPEC", { name: "NL80211_ATTR_UNSPEC", value: 0, type: "integer", description: "Unspecified attribute to catch errors" }],
  ["NL80211_ATTR_WIPHY", { name: "NL80211_ATTR_WIPHY", value: 1, type: "integer", description: "Index of wiphy to operate on" }],
  ["NL80211_ATTR_WIPHY_NAME", { name: "NL80211_ATTR_WIPHY_NAME", value: 2, type: "integer", description: "Wiphy name (used for renaming)" }],
  ["NL80211_ATTR_IFINDEX", { name: "NL80211_ATTR_IFINDEX", value: 3, type: "integer", description: "Network interface index of the device to operate on" }],
  ["NL80211_ATTR_IFNAME", { name: "NL80211_ATTR_IFNAME", value: 4, type: "integer", description: "Network interface name" }],
  ["NL80211_ATTR_IFTYPE", { name: "NL80211_ATTR_IFTYPE", value: 5, type: "integer", description: "Type of virtual interface" }],
  ["NL80211_ATTR_MAC", { name: "NL80211_ATTR_MAC", value: 6, type: "integer", description: "MAC address (various uses)" }],
  ["NL80211_ATTR_KEY_DATA", { name: "NL80211_ATTR_KEY_DATA", value: 7, type: "integer", description: "Temporal key data; for TKIP this consists of 16 bytes encryption key followed by 8 bytes each for TX and RX MIC keys" }],
  ["NL80211_ATTR_KEY_IDX", { name: "NL80211_ATTR_KEY_IDX", value: 8, type: "integer", description: "Key ID (u8, 0-3)" }],
  ["NL80211_ATTR_KEY_CIPHER", { name: "NL80211_ATTR_KEY_CIPHER", value: 9, type: "integer", description: "Key cipher suite (u32, as defined by IEEE 802.11 section 7.3.2.25.1)" }],
  ["NL80211_ATTR_KEY_SEQ", { name: "NL80211_ATTR_KEY_SEQ", value: 10, type: "integer", description: "Transmit key sequence number (IV/PN) for TKIP and CCMP keys, each six bytes in little endian" }],
  ["NL80211_ATTR_KEY_DEFAULT", { name: "NL80211_ATTR_KEY_DEFAULT", value: 11, type: "integer", description: "Flag attribute indicating the key is default key" }],
  ["NL80211_ATTR_BEACON_INTERVAL", { name: "NL80211_ATTR_BEACON_INTERVAL", value: 12, type: "integer", description: "Beacon interval in TU" }],
  ["NL80211_ATTR_DTIM_PERIOD", { name: "NL80211_ATTR_DTIM_PERIOD", value: 13, type: "integer", description: "DTIM period for beaconing" }],
  ["NL80211_ATTR_BEACON_HEAD", { name: "NL80211_ATTR_BEACON_HEAD", value: 14, type: "integer", description: "Portion of the beacon before the TIM IE" }],
  ["NL80211_ATTR_BEACON_TAIL", { name: "NL80211_ATTR_BEACON_TAIL", value: 15, type: "integer", description: "Portion of the beacon after the TIM IE" }],
  ["NL80211_ATTR_STA_AID", { name: "NL80211_ATTR_STA_AID", value: 16, type: "integer", description: "Association ID for the station (u16)" }],
  ["NL80211_ATTR_STA_FLAGS", { name: "NL80211_ATTR_STA_FLAGS", value: 17, type: "integer", description: "Station flags, nested element with NLA_FLAG attributes (deprecated, use NL80211_ATTR_STA_FLAGS2)" }],
  ["NL80211_ATTR_STA_LISTEN_INTERVAL", { name: "NL80211_ATTR_STA_LISTEN_INTERVAL", value: 18, type: "integer", description: "Listen interval as defined by IEEE 802.11 7.3.1.6 (u16)" }],
  ["NL80211_ATTR_STA_SUPPORTED_RATES", { name: "NL80211_ATTR_STA_SUPPORTED_RATES", value: 19, type: "integer", description: "Supported rates, array of supported rates as defined by IEEE 802.11 7.3.2.2" }],
  ["NL80211_ATTR_STA_VLAN", { name: "NL80211_ATTR_STA_VLAN", value: 20, type: "integer", description: "Interface index of VLAN interface to move station to, or the AP interface the station was originally added to" }],
  ["NL80211_ATTR_STA_INFO", { name: "NL80211_ATTR_STA_INFO", value: 21, type: "integer", description: "Information about a station, part of station info given for NL80211_CMD_GET_STATION" }],
  ["NL80211_ATTR_WIPHY_BANDS", { name: "NL80211_ATTR_WIPHY_BANDS", value: 22, type: "integer", description: "Information about an operating bands, consisting of a nested array" }],
  ["NL80211_ATTR_MNTR_FLAGS", { name: "NL80211_ATTR_MNTR_FLAGS", value: 23, type: "integer", description: "Flags, nested element with NLA_FLAG attributes of enum nl80211_mntr_flags" }],
  ["NL80211_ATTR_MESH_ID", { name: "NL80211_ATTR_MESH_ID", value: 24, type: "integer", description: "Mesh id (1-32 bytes)" }],
  ["NL80211_ATTR_STA_PLINK_ACTION", { name: "NL80211_ATTR_STA_PLINK_ACTION", value: 25, type: "integer", description: "Action to perform on the mesh peer link" }],
  ["NL80211_ATTR_MPATH_NEXT_HOP", { name: "NL80211_ATTR_MPATH_NEXT_HOP", value: 26, type: "integer", description: "MAC address of the next hop for a mesh path" }],
  ["NL80211_ATTR_MPATH_INFO", { name: "NL80211_ATTR_MPATH_INFO", value: 27, type: "integer", description: "Information about a mesh_path, part of mesh path info given for NL80211_CMD_GET_MPATH" }],
  ["NL80211_ATTR_BSS_CTS_PROT", { name: "NL80211_ATTR_BSS_CTS_PROT", value: 28, type: "integer", description: "Whether CTS protection is enabled (u8, 0 or 1)" }],
  ["NL80211_ATTR_BSS_SHORT_PREAMBLE", { name: "NL80211_ATTR_BSS_SHORT_PREAMBLE", value: 29, type: "integer", description: "Whether short preamble is enabled (u8, 0 or 1)" }],
  ["NL80211_ATTR_BSS_SHORT_SLOT_TIME", { name: "NL80211_ATTR_BSS_SHORT_SLOT_TIME", value: 30, type: "integer", description: "Whether short slot time enabled (u8, 0 or 1)" }],
  ["NL80211_ATTR_HT_CAPABILITY", { name: "NL80211_ATTR_HT_CAPABILITY", value: 31, type: "integer", description: "HT Capability information element (from association request when used with NL80211_CMD_NEW_STATION)" }],
  ["NL80211_ATTR_SUPPORTED_IFTYPES", { name: "NL80211_ATTR_SUPPORTED_IFTYPES", value: 32, type: "integer", description: "Nested attribute containing all supported interface types, each a flag attribute with the number of the interface mode" }],
  ["NL80211_ATTR_REG_ALPHA2", { name: "NL80211_ATTR_REG_ALPHA2", value: 33, type: "integer", description: "An ISO-3166-alpha2 country code for which the current regulatory domain should be set to or is already set to" }],
  ["NL80211_ATTR_REG_RULES", { name: "NL80211_ATTR_REG_RULES", value: 34, type: "integer", description: "A nested array of regulatory domain regulatory rules" }],
  ["NL80211_ATTR_MESH_CONFIG", { name: "NL80211_ATTR_MESH_CONFIG", value: 35, type: "integer", description: "Mesh configuration parameters, a nested attribute containing attributes from enum nl80211_meshconf_params" }],
  ["NL80211_ATTR_BSS_BASIC_RATES", { name: "NL80211_ATTR_BSS_BASIC_RATES", value: 36, type: "integer", description: "Basic rates, array of basic rates in format defined by IEEE 802.11 7.3.2.2 but without the length restriction" }],
  ["NL80211_ATTR_WIPHY_TXQ_PARAMS", { name: "NL80211_ATTR_WIPHY_TXQ_PARAMS", value: 37, type: "integer", description: "Wiphy name (used for renaming)" }],
  ["NL80211_ATTR_WIPHY_FREQ", { name: "NL80211_ATTR_WIPHY_FREQ", value: 38, type: "integer", description: "Frequency of the selected channel in MHz" }],
  ["NL80211_ATTR_WIPHY_CHANNEL_TYPE", { name: "NL80211_ATTR_WIPHY_CHANNEL_TYPE", value: 39, type: "integer", description: "Included with NL80211_ATTR_WIPHY_FREQ if HT20 or HT40 are to be used (deprecated)" }],
  ["NL80211_ATTR_KEY_DEFAULT_MGMT", { name: "NL80211_ATTR_KEY_DEFAULT_MGMT", value: 40, type: "integer", description: "Flag attribute indicating the key is the default management key" }],
  ["NL80211_ATTR_MGMT_SUBTYPE", { name: "NL80211_ATTR_MGMT_SUBTYPE", value: 41, type: "integer", description: "Management frame subtype for NL80211_CMD_SET_MGMT_EXTRA_IE" }],
  ["NL80211_ATTR_IE", { name: "NL80211_ATTR_IE", value: 42, type: "integer", description: "Information element(s) data (used, e.g., with NL80211_CMD_SET_MGMT_EXTRA_IE)" }],
  ["NL80211_ATTR_MAX_NUM_SCAN_SSIDS", { name: "NL80211_ATTR_MAX_NUM_SCAN_SSIDS", value: 43, type: "integer", description: "Number of SSIDs you can scan with a single scan request, a wiphy attribute" }],
  ["NL80211_ATTR_SCAN_FREQUENCIES", { name: "NL80211_ATTR_SCAN_FREQUENCIES", value: 44, type: "integer", description: "Nested attribute with frequencies (in MHz)" }],
  ["NL80211_ATTR_SCAN_SSIDS", { name: "NL80211_ATTR_SCAN_SSIDS", value: 45, type: "integer", description: "Nested attribute with SSIDs, leave out for passive scanning" }],
  ["NL80211_ATTR_GENERATION", { name: "NL80211_ATTR_GENERATION", value: 46, type: "integer", description: "Used to indicate consistent snapshots for dumps (replaces old SCAN_GENERATION)" }],
  ["NL80211_ATTR_BSS", { name: "NL80211_ATTR_BSS", value: 47, type: "integer", description: "Scan result BSS" }],
  ["NL80211_ATTR_REG_INITIATOR", { name: "NL80211_ATTR_REG_INITIATOR", value: 48, type: "integer", description: "Indicates who requested the regulatory domain currently in effect" }],
  ["NL80211_ATTR_REG_TYPE", { name: "NL80211_ATTR_REG_TYPE", value: 49, type: "integer", description: "Indicates the type of the regulatory domain currently set" }],
  ["NL80211_ATTR_SUPPORTED_COMMANDS", { name: "NL80211_ATTR_SUPPORTED_COMMANDS", value: 50, type: "integer", description: "Wiphy attribute that specifies an array of command numbers that the driver for the given wiphy supports" }],
  ["NL80211_ATTR_FRAME", { name: "NL80211_ATTR_FRAME", value: 51, type: "integer", description: "Frame data (binary attribute), including frame header and body, but not FCS" }],
  ["NL80211_ATTR_SSID", { name: "NL80211_ATTR_SSID", value: 52, type: "integer", description: "SSID (binary attribute, 0..32 octets)" }],
  ["NL80211_ATTR_AUTH_TYPE", { name: "NL80211_ATTR_AUTH_TYPE", value: 53, type: "integer", description: "AuthenticationType, see enum nl80211_auth_type, represented as a u32" }],
  ["NL80211_ATTR_REASON_CODE", { name: "NL80211_ATTR_REASON_CODE", value: 54, type: "integer", description: "ReasonCode for NL80211_CMD_DEAUTHENTICATE and NL80211_CMD_DISASSOCIATE, u16" }],
  ["NL80211_ATTR_KEY_TYPE", { name: "NL80211_ATTR_KEY_TYPE", value: 55, type: "integer", description: "Key Type, see enum nl80211_key_type, represented as a u32" }],
  ["NL80211_ATTR_MAX_SCAN_IE_LEN", { name: "NL80211_ATTR_MAX_SCAN_IE_LEN", value: 56, type: "integer", description: "Maximum length of information elements that can be added to a scan request" }],
  ["NL80211_ATTR_CIPHER_SUITES", { name: "NL80211_ATTR_CIPHER_SUITES", value: 57, type: "integer", description: "A set of u32 values indicating the supported cipher suites" }],
  ["NL80211_ATTR_FREQ_BEFORE", { name: "NL80211_ATTR_FREQ_BEFORE", value: 58, type: "integer", description: "A channel which has suffered a regulatory change due to considerations from a beacon hint (before state)" }],
  ["NL80211_ATTR_FREQ_AFTER", { name: "NL80211_ATTR_FREQ_AFTER", value: 59, type: "integer", description: "A channel which has suffered a regulatory change due to considerations from a beacon hint (after state)" }],
  ["NL80211_ATTR_FREQ_FIXED", { name: "NL80211_ATTR_FREQ_FIXED", value: 60, type: "integer", description: "A flag indicating the IBSS should not try to look for other networks on different channels" }],
  ["NL80211_ATTR_WIPHY_RETRY_SHORT", { name: "NL80211_ATTR_WIPHY_RETRY_SHORT", value: 61, type: "integer", description: "TX retry limit for frames whose length is less than or equal to the RTS threshold" }],
  ["NL80211_ATTR_WIPHY_RETRY_LONG", { name: "NL80211_ATTR_WIPHY_RETRY_LONG", value: 62, type: "integer", description: "TX retry limit for frames whose length is greater than the RTS threshold" }],
  ["NL80211_ATTR_WIPHY_FRAG_THRESHOLD", { name: "NL80211_ATTR_WIPHY_FRAG_THRESHOLD", value: 63, type: "integer", description: "Fragmentation threshold, i.e., maximum length in octets for frames" }],
  ["NL80211_ATTR_WIPHY_RTS_THRESHOLD", { name: "NL80211_ATTR_WIPHY_RTS_THRESHOLD", value: 64, type: "integer", description: "RTS threshold (TX frames with length larger than or equal to this use RTS/CTS handshake)" }],
  ["NL80211_ATTR_TIMED_OUT", { name: "NL80211_ATTR_TIMED_OUT", value: 65, type: "integer", description: "A flag indicating than an operation timed out" }],
  ["NL80211_ATTR_USE_MFP", { name: "NL80211_ATTR_USE_MFP", value: 66, type: "integer", description: "Whether management frame protection (IEEE 802.11w) is used for the association" }],
  ["NL80211_ATTR_STA_FLAGS2", { name: "NL80211_ATTR_STA_FLAGS2", value: 67, type: "integer", description: "Attribute containing a struct nl80211_sta_flag_update" }],
  ["NL80211_ATTR_CONTROL_PORT", { name: "NL80211_ATTR_CONTROL_PORT", value: 68, type: "integer", description: "A flag indicating whether user space controls IEEE 802.1X port" }],
  ["NL80211_ATTR_TESTDATA", { name: "NL80211_ATTR_TESTDATA", value: 69, type: "integer", description: "Testmode data blob, passed through to the driver" }],
  ["NL80211_ATTR_PRIVACY", { name: "NL80211_ATTR_PRIVACY", value: 70, type: "integer", description: "Flag attribute, used with connect(), indicating that protected APs should be used" }],
  ["NL80211_ATTR_DISCONNECTED_BY_AP", { name: "NL80211_ATTR_DISCONNECTED_BY_AP", value: 71, type: "integer", description: "A flag indicating that the DISCONNECT event was due to the AP disconnecting the station" }],
  ["NL80211_ATTR_STATUS_CODE", { name: "NL80211_ATTR_STATUS_CODE", value: 72, type: "integer", description: "StatusCode for the NL80211_CMD_CONNECT event (u16)" }],
  ["NL80211_ATTR_CIPHER_SUITES_PAIRWISE", { name: "NL80211_ATTR_CIPHER_SUITES_PAIRWISE", value: 73, type: "integer", description: "For crypto settings for connect or other commands, indicates which pairwise cipher suites are used" }],
  ["NL80211_ATTR_CIPHER_SUITE_GROUP", { name: "NL80211_ATTR_CIPHER_SUITE_GROUP", value: 74, type: "integer", description: "For crypto settings for connect or other commands, indicates which group cipher suite is used" }],
  ["NL80211_ATTR_WPA_VERSIONS", { name: "NL80211_ATTR_WPA_VERSIONS", value: 75, type: "integer", description: "Used with CONNECT, ASSOCIATE, and NEW_BEACON to indicate which WPA version(s) the AP we want to associate with is using" }],
  ["NL80211_ATTR_AKM_SUITES", { name: "NL80211_ATTR_AKM_SUITES", value: 76, type: "integer", description: "Used with CONNECT, ASSOCIATE, and NEW_BEACON to indicate which key management algorithm(s) to use" }],
  ["NL80211_ATTR_REQ_IE", { name: "NL80211_ATTR_REQ_IE", value: 77, type: "integer", description: "(Re)association request information elements as sent out by the card, for ROAM and successful CONNECT events" }],
  ["NL80211_ATTR_RESP_IE", { name: "NL80211_ATTR_RESP_IE", value: 78, type: "integer", description: "(Re)association response information elements as sent by peer, for ROAM and successful CONNECT events" }],
  ["NL80211_ATTR_PREV_BSSID", { name: "NL80211_ATTR_PREV_BSSID", value: 79, type: "integer", description: "Previous BSSID, to be used in ASSOCIATE and CONNECT commands to specify a request to reassociate within an ESS" }],
  ["NL80211_ATTR_KEY", { name: "NL80211_ATTR_KEY", value: 80, type: "integer", description: "Key information in a nested attribute with NL80211_KEY_* sub-attributes" }],
  ["NL80211_ATTR_KEYS", { name: "NL80211_ATTR_KEYS", value: 81, type: "integer", description: "Array of keys for static WEP keys for connect() and join_ibss(), key information is in a nested attribute each with NL80211_KEY_* sub-attributes" }],
  ["NL80211_ATTR_PID", { name: "NL80211_ATTR_PID", value: 82, type: "integer", description: "Process ID of a network namespace" }],
  ["NL80211_ATTR_4ADDR", { name: "NL80211_ATTR_4ADDR", value: 83, type: "integer", description: "Use 4-address frames on a virtual interface" }],
  ["NL80211_ATTR_SURVEY_INFO", { name: "NL80211_ATTR_SURVEY_INFO", value: 84, type: "integer", description: "Survey information about a channel, part of the survey response for NL80211_CMD_GET_SURVEY" }],
  ["NL80211_ATTR_PMKID", { name: "NL80211_ATTR_PMKID", value: 85, type: "integer", description: "PMK material for PMKSA caching" }],
  ["NL80211_ATTR_MAX_NUM_PMKIDS", { name: "NL80211_ATTR_MAX_NUM_PMKIDS", value: 86, type: "integer", description: "Maximum number of PMKIDs a firmware can cache, a wiphy attribute" }],
  ["NL80211_ATTR_DURATION", { name: "NL80211_ATTR_DURATION", value: 87, type: "integer", description: "Duration of an operation in milliseconds, u32" }],
  ["NL80211_ATTR_COOKIE", { name: "NL80211_ATTR_COOKIE", value: 88, type: "integer", description: "Generic 64-bit cookie to identify objects" }],
  ["NL80211_ATTR_WIPHY_COVERAGE_CLASS", { name: "NL80211_ATTR_WIPHY_COVERAGE_CLASS", value: 89, type: "integer", description: "Coverage Class as defined by IEEE 802.11 section 7.3.2.9; dot11CoverageClass; u8" }],
  ["NL80211_ATTR_TX_RATES", { name: "NL80211_ATTR_TX_RATES", value: 90, type: "integer", description: "Nested set of attributes describing TX rates per band" }],
  ["NL80211_ATTR_FRAME_MATCH", { name: "NL80211_ATTR_FRAME_MATCH", value: 91, type: "integer", description: "A binary attribute which typically must contain at least one byte, currently used with NL80211_CMD_REGISTER_FRAME" }],
  ["NL80211_ATTR_ACK", { name: "NL80211_ATTR_ACK", value: 92, type: "integer", description: "Flag attribute indicating that the frame was acknowledged by the recipient" }],
  ["NL80211_ATTR_PS_STATE", { name: "NL80211_ATTR_PS_STATE", value: 93, type: "integer", description: "Powersave state, using enum nl80211_ps_state values" }],
  ["NL80211_ATTR_CQM", { name: "NL80211_ATTR_CQM", value: 94, type: "integer", description: "Connection quality monitor configuration in a nested attribute with NL80211_ATTR_CQM_* sub-attributes" }],
  ["NL80211_ATTR_LOCAL_STATE_CHANGE", { name: "NL80211_ATTR_LOCAL_STATE_CHANGE", value: 95, type: "integer", description: "Flag attribute to indicate that a command is requesting a local authentication/association state change" }],
  ["NL80211_ATTR_AP_ISOLATE", { name: "NL80211_ATTR_AP_ISOLATE", value: 96, type: "integer", description: "(AP mode) Do not forward traffic between stations connected to this BSS" }],
  ["NL80211_ATTR_WIPHY_TX_POWER_SETTING", { name: "NL80211_ATTR_WIPHY_TX_POWER_SETTING", value: 97, type: "integer", description: "Transmit power setting type" }],
  ["NL80211_ATTR_WIPHY_TX_POWER_LEVEL", { name: "NL80211_ATTR_WIPHY_TX_POWER_LEVEL", value: 98, type: "integer", description: "Transmit power level in signed mBm units" }],
  ["NL80211_ATTR_TX_FRAME_TYPES", { name: "NL80211_ATTR_TX_FRAME_TYPES", value: 99, type: "integer", description: "Wiphy capability attribute, which is a nested attribute of NL80211_ATTR_FRAME_TYPE attributes" }],
  ["NL80211_ATTR_RX_FRAME_TYPES", { name: "NL80211_ATTR_RX_FRAME_TYPES", value: 100, type: "integer", description: "Wiphy capability attribute, which is a nested attribute of NL80211_ATTR_FRAME_TYPE attributes" }],
  ["NL80211_ATTR_FRAME_TYPE", { name: "NL80211_ATTR_FRAME_TYPE", value: 101, type: "integer", description: "A u16 indicating the frame type/subtype for the NL80211_CMD_REGISTER_FRAME command" }],
  ["NL80211_ATTR_CONTROL_PORT_ETHERTYPE", { name: "NL80211_ATTR_CONTROL_PORT_ETHERTYPE", value: 102, type: "integer", description: "A 16-bit value indicating the ethertype that will be used for key negotiation" }],
  ["NL80211_ATTR_CONTROL_PORT_NO_ENCRYPT", { name: "NL80211_ATTR_CONTROL_PORT_NO_ENCRYPT", value: 103, type: "integer", description: "When included along with NL80211_ATTR_CONTROL_PORT_ETHERTYPE, indicates that the custom ethertype frames used for key negotiation must not be encrypted" }],
  ["NL80211_ATTR_SUPPORT_IBSS_RSN", { name: "NL80211_ATTR_SUPPORT_IBSS_RSN", value: 104, type: "integer", description: "The device supports IBSS RSN, which mostly means support for per-station GTKs" }],
  ["NL80211_ATTR_WIPHY_ANTENNA_TX", { name: "NL80211_ATTR_WIPHY_ANTENNA_TX", value: 105, type: "integer", description: "Bitmap of allowed antennas for transmitting" }],
  ["NL80211_ATTR_WIPHY_ANTENNA_RX", { name: "NL80211_ATTR_WIPHY_ANTENNA_RX", value: 106, type: "integer", description: "Bitmap of allowed antennas for receiving" }],
  ["NL80211_ATTR_MCAST_RATE", { name: "NL80211_ATTR_MCAST_RATE", value: 107, type: "integer", description: "Multicast tx rate (in 100 kbps) for IBSS" }],
  ["NL80211_ATTR_OFFCHANNEL_TX_OK", { name: "NL80211_ATTR_OFFCHANNEL_TX_OK", value: 108, type: "integer", description: "For management frame TX, the frame may be transmitted on another channel when the channel given doesn't match the current channel" }],
  ["NL80211_ATTR_BSS_HT_OPMODE", { name: "NL80211_ATTR_BSS_HT_OPMODE", value: 109, type: "integer", description: "HT operation mode (u16)" }],
  ["NL80211_ATTR_KEY_DEFAULT_TYPES", { name: "NL80211_ATTR_KEY_DEFAULT_TYPES", value: 110, type: "integer", description: "A nested attribute containing flags attributes, specifying what a key should be set as default as" }],
  ["NL80211_ATTR_MAX_REMAIN_ON_CHANNEL_DURATION", { name: "NL80211_ATTR_MAX_REMAIN_ON_CHANNEL_DURATION", value: 111, type: "integer", description: "Device attribute that specifies the maximum duration that can be requested with the remain-on-channel operation, in milliseconds, u32" }],
  ["NL80211_ATTR_MESH_SETUP", { name: "NL80211_ATTR_MESH_SETUP", value: 112, type: "integer", description: "Optional mesh setup parameters. These cannot be changed once the mesh is active" }],
  ["NL80211_ATTR_WIPHY_ANTENNA_AVAIL_TX", { name: "NL80211_ATTR_WIPHY_ANTENNA_AVAIL_TX", value: 113, type: "integer", description: "Bitmap of antennas which are available for configuration as TX antennas via the above parameters" }],
  ["NL80211_ATTR_WIPHY_ANTENNA_AVAIL_RX", { name: "NL80211_ATTR_WIPHY_ANTENNA_AVAIL_RX", value: 114, type: "integer", description: "Bitmap of antennas which are available for configuration as RX antennas via the above parameters" }],
  ["NL80211_ATTR_SUPPORT_MESH_AUTH", { name: "NL80211_ATTR_SUPPORT_MESH_AUTH", value: 115, type: "integer", description: "Currently, this means the underlying driver allows auth frames in a mesh to be passed to userspace for processing via the NL80211_MESH_SETUP_USERSPACE_AUTH flag" }],
  ["NL80211_ATTR_STA_PLINK_STATE", { name: "NL80211_ATTR_STA_PLINK_STATE", value: 116, type: "integer", description: "The state of a mesh peer link as defined in enum nl80211_plink_state" }],
  ["NL80211_ATTR_WOWLAN_TRIGGERS", { name: "NL80211_ATTR_WOWLAN_TRIGGERS", value: 117, type: "integer", description: "Used by NL80211_CMD_SET_WOWLAN to indicate which WoW triggers should be enabled" }],
  ["NL80211_ATTR_WOWLAN_TRIGGERS_SUPPORTED", { name: "NL80211_ATTR_WOWLAN_TRIGGERS_SUPPORTED", value: 118, type: "integer", description: "Indicates, as part of the wiphy capabilities, the supported WoWLAN triggers" }],
  ["NL80211_ATTR_SCHED_SCAN_INTERVAL", { name: "NL80211_ATTR_SCHED_SCAN_INTERVAL", value: 119, type: "integer", description: "Interval between scheduled scan cycles, in msecs" }],
  ["NL80211_ATTR_INTERFACE_COMBINATIONS", { name: "NL80211_ATTR_INTERFACE_COMBINATIONS", value: 120, type: "integer", description: "Nested attribute listing the supported interface combinations" }],
  ["NL80211_ATTR_SOFTWARE_IFTYPES", { name: "NL80211_ATTR_SOFTWARE_IFTYPES", value: 121, type: "integer", description: "Nested attribute (just like NL80211_ATTR_SUPPORTED_IFTYPES) containing the interface types that are managed in software" }],
  ["NL80211_ATTR_REKEY_DATA", { name: "NL80211_ATTR_REKEY_DATA", value: 122, type: "integer", description: "Nested attribute containing the information necessary for GTK rekeying in the device" }],
  ["NL80211_ATTR_MAX_NUM_SCHED_SCAN_SSIDS", { name: "NL80211_ATTR_MAX_NUM_SCHED_SCAN_SSIDS", value: 123, type: "integer", description: "Number of SSIDs you can scan with a single scheduled scan request, a wiphy attribute" }],
  ["NL80211_ATTR_MAX_SCHED_SCAN_IE_LEN", { name: "NL80211_ATTR_MAX_SCHED_SCAN_IE_LEN", value: 124, type: "integer", description: "Maximum length of information elements that can be added to a scheduled scan request" }],
  ["NL80211_ATTR_SCAN_SUPP_RATES", { name: "NL80211_ATTR_SCAN_SUPP_RATES", value: 125, type: "integer", description: "Rates per to be advertised as supported in scan" }],
  ["NL80211_ATTR_HIDDEN_SSID", { name: "NL80211_ATTR_HIDDEN_SSID", value: 126, type: "integer", description: "Indicates whether SSID is to be hidden from Beacon and Probe Response" }],
  ["NL80211_ATTR_IE_PROBE_RESP", { name: "NL80211_ATTR_IE_PROBE_RESP", value: 127, type: "integer", description: "Information element(s) for Probe Response frame" }],
  ["NL80211_ATTR_IE_ASSOC_RESP", { name: "NL80211_ATTR_IE_ASSOC_RESP", value: 128, type: "integer", description: "Information element(s) for (Re)Association Response frames" }],
  ["NL80211_ATTR_STA_WME", { name: "NL80211_ATTR_STA_WME", value: 129, type: "integer", description: "Nested attribute containing the wme configuration of the station" }],
  ["NL80211_ATTR_SUPPORT_AP_UAPSD", { name: "NL80211_ATTR_SUPPORT_AP_UAPSD", value: 130, type: "integer", description: "The device supports uapsd when working as AP" }],
  ["NL80211_ATTR_ROAM_SUPPORT", { name: "NL80211_ATTR_ROAM_SUPPORT", value: 131, type: "integer", description: "Indicates whether the firmware is capable of roaming to another AP in the same ESS if the signal lever is low" }],
  ["NL80211_ATTR_SCHED_SCAN_MATCH", { name: "NL80211_ATTR_SCHED_SCAN_MATCH", value: 132, type: "integer", description: "Nested attribute with one or more sets of attributes to match during scheduled scans" }],
  ["NL80211_ATTR_MAX_MATCH_SETS", { name: "NL80211_ATTR_MAX_MATCH_SETS", value: 133, type: "integer", description: "Maximum number of sets that can be used with NL80211_ATTR_SCHED_SCAN_MATCH, a wiphy attribute" }],
  ["NL80211_ATTR_PMKSA_CANDIDATE", { name: "NL80211_ATTR_PMKSA_CANDIDATE", value: 134, type: "integer", description: "Nested attribute containing the PMKSA caching candidate information" }],
  ["NL80211_ATTR_TX_NO_CCK_RATE", { name: "NL80211_ATTR_TX_NO_CCK_RATE", value: 135, type: "integer", description: "Indicates whether to use CCK rate or not for management frames transmission" }],
  ["NL80211_ATTR_TDLS_ACTION", { name: "NL80211_ATTR_TDLS_ACTION", value: 136, type: "integer", description: "Low level TDLS action code (e.g. link setup request, link setup confirm, link teardown, etc.)" }],
  ["NL80211_ATTR_TDLS_DIALOG_TOKEN", { name: "NL80211_ATTR_TDLS_DIALOG_TOKEN", value: 137, type: "integer", description: "Non-zero token for uniquely identifying a TDLS conversation between two devices" }],
  ["NL80211_ATTR_TDLS_OPERATION", { name: "NL80211_ATTR_TDLS_OPERATION", value: 138, type: "integer", description: "High level TDLS operation" }],
  ["NL80211_ATTR_TDLS_SUPPORT", { name: "NL80211_ATTR_TDLS_SUPPORT", value: 139, type: "integer", description: "A flag indicating the device can operate as a TDLS peer sta" }],
  ["NL80211_ATTR_TDLS_EXTERNAL_SETUP", { name: "NL80211_ATTR_TDLS_EXTERNAL_SETUP", value: 140, type: "integer", description: "The TDLS discovery/setup and teardown procedures should be performed by sending TDLS packets via NL80211_CMD_TDLS_MGMT" }],
  ["NL80211_ATTR_DEVICE_AP_SME", { name: "NL80211_ATTR_DEVICE_AP_SME", value: 141, type: "integer", description: "This u32 attribute may be listed for devices that have AP support to indicate that they have the AP SME integrated" }],
  ["NL80211_ATTR_DONT_WAIT_FOR_ACK", { name: "NL80211_ATTR_DONT_WAIT_FOR_ACK", value: 142, type: "integer", description: "Used with NL80211_CMD_FRAME, this tells the driver to not wait for an acknowledgement" }],
  ["NL80211_ATTR_FEATURE_FLAGS", { name: "NL80211_ATTR_FEATURE_FLAGS", value: 143, type: "integer", description: "This u32 attribute contains flags from enum nl80211_feature_flags and is advertised in wiphy information" }],
  ["NL80211_ATTR_PROBE_RESP_OFFLOAD", { name: "NL80211_ATTR_PROBE_RESP_OFFLOAD", value: 144, type: "integer", description: "Indicates that the HW responds to probe requests while operating in AP-mode" }],
  ["NL80211_ATTR_PROBE_RESP", { name: "NL80211_ATTR_PROBE_RESP", value: 145, type: "integer", description: "Probe Response template data. Contains the entire probe-response frame" }],
  ["NL80211_ATTR_DFS_REGION", { name: "NL80211_ATTR_DFS_REGION", value: 146, type: "integer", description: "Region for regulatory rules which this country abides to when initiating radiation on DFS channels" }],
  ["NL80211_ATTR_DISABLE_HT", { name: "NL80211_ATTR_DISABLE_HT", value: 147, type: "integer", description: "Force HT capable interfaces to disable this feature during association" }],
  ["NL80211_ATTR_HT_CAPABILITY_MASK", { name: "NL80211_ATTR_HT_CAPABILITY_MASK", value: 148, type: "integer", description: "Specify which bits of the ATTR_HT_CAPABILITY to which attention should be paid" }],
  ["NL80211_ATTR_NOACK_MAP", { name: "NL80211_ATTR_NOACK_MAP", value: 149, type: "integer", description: "This u16 bitmap contains the No Ack Policy of up to 16 TIDs" }],
  ["NL80211_ATTR_INACTIVITY_TIMEOUT", { name: "NL80211_ATTR_INACTIVITY_TIMEOUT", value: 150, type: "integer", description: "Timeout value in seconds, this can be used by the drivers which has MLME in firmware and does not have support to report per station tx/rx activity" }],
  ["NL80211_ATTR_RX_SIGNAL_DBM", { name: "NL80211_ATTR_RX_SIGNAL_DBM", value: 151, type: "integer", description: "Signal strength in dBm (as a 32-bit int)" }],
  ["NL80211_ATTR_BG_SCAN_PERIOD", { name: "NL80211_ATTR_BG_SCAN_PERIOD", value: 152, type: "integer", description: "Background scan period in seconds or 0 to disable background scan" }],
  ["NL80211_ATTR_WDEV", { name: "NL80211_ATTR_WDEV", value: 153, type: "integer", description: "Wireless device identifier, used for pseudo-devices that don't have a netdev (u64)" }],
  ["NL80211_ATTR_USER_REG_HINT_TYPE", { name: "NL80211_ATTR_USER_REG_HINT_TYPE", value: 154, type: "integer", description: "Type of regulatory hint passed from userspace" }],
  ["NL80211_ATTR_CONN_FAILED_REASON", { name: "NL80211_ATTR_CONN_FAILED_REASON", value: 155, type: "integer", description: "The reason for which AP has rejected the connection request from a station" }],
  ["NL80211_ATTR_AUTH_DATA", { name: "NL80211_ATTR_AUTH_DATA", value: 156, type: "integer", description: "Fields and elements in Authentication frames" }],
  ["NL80211_ATTR_VHT_CAPABILITY", { name: "NL80211_ATTR_VHT_CAPABILITY", value: 157, type: "integer", description: "VHT Capability information element (from association request when used with NL80211_CMD_NEW_STATION)" }],
  ["NL80211_ATTR_SCAN_FLAGS", { name: "NL80211_ATTR_SCAN_FLAGS", value: 158, type: "integer", description: "Scan request control flags (u32)" }],
  ["NL80211_ATTR_CHANNEL_WIDTH", { name: "NL80211_ATTR_CHANNEL_WIDTH", value: 159, type: "integer", description: "U32 attribute containing one of the values of enum nl80211_chan_width, describing the channel width" }],
  ["NL80211_ATTR_CENTER_FREQ1", { name: "NL80211_ATTR_CENTER_FREQ1", value: 160, type: "integer", description: "Center frequency of the first part of the channel, used for anything but 20 MHz bandwidth" }],
  ["NL80211_ATTR_CENTER_FREQ2", { name: "NL80211_ATTR_CENTER_FREQ2", value: 161, type: "integer", description: "Center frequency of the second part of the channel, used only for 80+80 MHz bandwidth" }],
  // Additional NL80211 Attribute Constants - remaining important ones
  ["NL80211_ATTR_P2P_CTWINDOW", { name: "NL80211_ATTR_P2P_CTWINDOW", value: 162, type: "integer", description: "P2P GO Client Traffic Window (u8)" }],
  ["NL80211_ATTR_P2P_OPPPS", { name: "NL80211_ATTR_P2P_OPPPS", value: 163, type: "integer", description: "P2P GO opportunistic PS (u8)" }],
  ["NL80211_ATTR_LOCAL_MESH_POWER_MODE", { name: "NL80211_ATTR_LOCAL_MESH_POWER_MODE", value: 164, type: "integer", description: "Local mesh STA link-specific power mode" }],
  ["NL80211_ATTR_ACL_POLICY", { name: "NL80211_ATTR_ACL_POLICY", value: 165, type: "integer", description: "ACL policy" }],
  ["NL80211_ATTR_MAC_ADDRS", { name: "NL80211_ATTR_MAC_ADDRS", value: 166, type: "integer", description: "Array of nested MAC addresses, used for MAC ACL" }],
  ["NL80211_ATTR_MAC_ACL_MAX", { name: "NL80211_ATTR_MAC_ACL_MAX", value: 167, type: "integer", description: "U32 attribute to advertise the maximum number of MAC addresses that a device can support for MAC ACL" }],
  ["NL80211_ATTR_RADAR_EVENT", { name: "NL80211_ATTR_RADAR_EVENT", value: 168, type: "integer", description: "Type of radar event for notification to userspace" }],
  ["NL80211_ATTR_EXT_CAPA", { name: "NL80211_ATTR_EXT_CAPA", value: 169, type: "integer", description: "802.11 extended capabilities that the kernel driver has and handles" }],
  ["NL80211_ATTR_EXT_CAPA_MASK", { name: "NL80211_ATTR_EXT_CAPA_MASK", value: 170, type: "integer", description: "Extended capabilities that the kernel driver has set in the NL80211_ATTR_EXT_CAPA value" }],
  ["NL80211_ATTR_STA_CAPABILITY", { name: "NL80211_ATTR_STA_CAPABILITY", value: 171, type: "integer", description: "Station capabilities (u16) are advertised to the driver" }],
  ["NL80211_ATTR_STA_EXT_CAPABILITY", { name: "NL80211_ATTR_STA_EXT_CAPABILITY", value: 172, type: "integer", description: "Station extended capabilities are advertised to the driver" }],
  ["NL80211_ATTR_PROTOCOL_FEATURES", { name: "NL80211_ATTR_PROTOCOL_FEATURES", value: 173, type: "integer", description: "Global nl80211 feature flags" }],
  ["NL80211_ATTR_SPLIT_WIPHY_DUMP", { name: "NL80211_ATTR_SPLIT_WIPHY_DUMP", value: 174, type: "integer", description: "Flag attribute, userspace supports receiving the data for a single wiphy split across multiple messages" }],
  ["NL80211_ATTR_DISABLE_VHT", { name: "NL80211_ATTR_DISABLE_VHT", value: 175, type: "integer", description: "Force VHT capable interfaces to disable this feature during association" }],
  ["NL80211_ATTR_VHT_CAPABILITY_MASK", { name: "NL80211_ATTR_VHT_CAPABILITY_MASK", value: 176, type: "integer", description: "Specify which bits of the ATTR_VHT_CAPABILITY to which attention should be paid" }],
  ["NL80211_ATTR_MDID", { name: "NL80211_ATTR_MDID", value: 177, type: "integer", description: "Mobility Domain Identifier" }],
  ["NL80211_ATTR_IE_RIC", { name: "NL80211_ATTR_IE_RIC", value: 178, type: "integer", description: "Resource Information Container Information Element" }],
  ["NL80211_ATTR_CRIT_PROT_ID", { name: "NL80211_ATTR_CRIT_PROT_ID", value: 179, type: "integer", description: "Critical protocol identifier requiring increased reliability" }],
  ["NL80211_ATTR_MAX_CRIT_PROT_DURATION", { name: "NL80211_ATTR_MAX_CRIT_PROT_DURATION", value: 180, type: "integer", description: "Duration in milliseconds in which the connection should have increased reliability (u16)" }],
  ["NL80211_ATTR_PEER_AID", { name: "NL80211_ATTR_PEER_AID", value: 181, type: "integer", description: "Association ID for the peer TDLS station (u16)" }],
  ["NL80211_ATTR_COALESCE_RULE", { name: "NL80211_ATTR_COALESCE_RULE", value: 182, type: "integer", description: "Coalesce rule information" }],
  ["NL80211_ATTR_CH_SWITCH_COUNT", { name: "NL80211_ATTR_CH_SWITCH_COUNT", value: 183, type: "integer", description: "U32 attribute specifying the number of TBTT's until the channel switch event" }],
  ["NL80211_ATTR_CH_SWITCH_BLOCK_TX", { name: "NL80211_ATTR_CH_SWITCH_BLOCK_TX", value: 184, type: "integer", description: "Flag attribute specifying that transmission must be blocked on the current channel" }],
  ["NL80211_ATTR_CSA_IES", { name: "NL80211_ATTR_CSA_IES", value: 185, type: "integer", description: "Nested set of attributes containing the IE information for the time while performing a channel switch" }],
  ["NL80211_ATTR_CNTDWN_OFFS_BEACON", { name: "NL80211_ATTR_CNTDWN_OFFS_BEACON", value: 186, type: "integer", description: "An array of offsets (u16) to the channel switch or color change counters in the beacons tail" }],
  ["NL80211_ATTR_CNTDWN_OFFS_PRESP", { name: "NL80211_ATTR_CNTDWN_OFFS_PRESP", value: 187, type: "integer", description: "An array of offsets (u16) to the channel switch or color change counters in the probe response" }],
  ["NL80211_ATTR_RXMGMT_FLAGS", { name: "NL80211_ATTR_RXMGMT_FLAGS", value: 188, type: "integer", description: "Flags for nl80211_send_mgmt(), u32" }],
  ["NL80211_ATTR_STA_SUPPORTED_CHANNELS", { name: "NL80211_ATTR_STA_SUPPORTED_CHANNELS", value: 189, type: "integer", description: "Array of supported channels" }],
  ["NL80211_ATTR_STA_SUPPORTED_OPER_CLASSES", { name: "NL80211_ATTR_STA_SUPPORTED_OPER_CLASSES", value: 190, type: "integer", description: "Array of supported operating classes" }],
  ["NL80211_ATTR_HANDLE_DFS", { name: "NL80211_ATTR_HANDLE_DFS", value: 191, type: "integer", description: "A flag indicating whether user space controls DFS operation in IBSS mode" }],
  ["NL80211_ATTR_SUPPORT_5_MHZ", { name: "NL80211_ATTR_SUPPORT_5_MHZ", value: 192, type: "integer", description: "A flag indicating that the device supports 5 MHz channel bandwidth" }],
  ["NL80211_ATTR_SUPPORT_10_MHZ", { name: "NL80211_ATTR_SUPPORT_10_MHZ", value: 193, type: "integer", description: "A flag indicating that the device supports 10 MHz channel bandwidth" }],
  ["NL80211_ATTR_OPMODE_NOTIF", { name: "NL80211_ATTR_OPMODE_NOTIF", value: 194, type: "integer", description: "Operating mode field from Operating Mode Notification Element" }],
  ["NL80211_ATTR_VENDOR_ID", { name: "NL80211_ATTR_VENDOR_ID", value: 195, type: "integer", description: "The vendor ID, either a 24-bit OUI or, if NL80211_VENDOR_ID_IS_LINUX is set, a special Linux ID" }],
  ["NL80211_ATTR_VENDOR_SUBCMD", { name: "NL80211_ATTR_VENDOR_SUBCMD", value: 196, type: "integer", description: "Vendor sub-command" }],
  ["NL80211_ATTR_VENDOR_DATA", { name: "NL80211_ATTR_VENDOR_DATA", value: 197, type: "integer", description: "Data for the vendor command, if any; this attribute is also used for vendor command feature advertisement" }],
  ["NL80211_ATTR_VENDOR_EVENTS", { name: "NL80211_ATTR_VENDOR_EVENTS", value: 198, type: "integer", description: "Used for event list advertising in the wiphy info, containing a nested array of possible events" }],
  ["NL80211_ATTR_QOS_MAP", { name: "NL80211_ATTR_QOS_MAP", value: 199, type: "integer", description: "IP DSCP mapping for Interworking QoS mapping" }],
  ["NL80211_ATTR_MAC_HINT", { name: "NL80211_ATTR_MAC_HINT", value: 200, type: "integer", description: "MAC address recommendation as initial BSS" }],
  ["NL80211_ATTR_WIPHY_FREQ_HINT", { name: "NL80211_ATTR_WIPHY_FREQ_HINT", value: 201, type: "integer", description: "Frequency of the recommended initial BSS" }],
  ["NL80211_ATTR_MAX_AP_ASSOC_STA", { name: "NL80211_ATTR_MAX_AP_ASSOC_STA", value: 202, type: "integer", description: "Device attribute that indicates how many associated stations are supported in AP mode" }],
  ["NL80211_ATTR_TDLS_PEER_CAPABILITY", { name: "NL80211_ATTR_TDLS_PEER_CAPABILITY", value: 203, type: "integer", description: "Flags for TDLS peer capabilities, u32" }],
  ["NL80211_ATTR_SOCKET_OWNER", { name: "NL80211_ATTR_SOCKET_OWNER", value: 204, type: "integer", description: "Flag attribute, if set during interface creation then the new interface will be owned by the netlink socket that created it" }],
  ["NL80211_ATTR_CSA_C_OFFSETS_TX", { name: "NL80211_ATTR_CSA_C_OFFSETS_TX", value: 205, type: "integer", description: "An array of csa counter offsets (u16) which should be updated when the frame is transmitted" }],
  ["NL80211_ATTR_MAX_CSA_COUNTERS", { name: "NL80211_ATTR_MAX_CSA_COUNTERS", value: 206, type: "integer", description: "U8 attribute used to advertise the maximum supported number of csa counters" }],
  ["NL80211_ATTR_TDLS_INITIATOR", { name: "NL80211_ATTR_TDLS_INITIATOR", value: 207, type: "integer", description: "Flag attribute indicating the current end is the TDLS link initiator" }],
  ["NL80211_ATTR_USE_RRM", { name: "NL80211_ATTR_USE_RRM", value: 208, type: "integer", description: "Flag for indicating whether the current connection shall support Radio Resource Measurements (11k)" }],
  ["NL80211_ATTR_WIPHY_DYN_ACK", { name: "NL80211_ATTR_WIPHY_DYN_ACK", value: 209, type: "integer", description: "Flag attribute used to enable ACK timeout estimation algorithm (dynack)" }],
  ["NL80211_ATTR_TSID", { name: "NL80211_ATTR_TSID", value: 210, type: "integer", description: "A TSID value (u8 attribute)" }],
  ["NL80211_ATTR_USER_PRIO", { name: "NL80211_ATTR_USER_PRIO", value: 211, type: "integer", description: "User priority value (u8 attribute)" }],
  ["NL80211_ATTR_ADMITTED_TIME", { name: "NL80211_ATTR_ADMITTED_TIME", value: 212, type: "integer", description: "Admitted time in units of 32 microseconds (per second) (u16 attribute)" }],
  ["NL80211_ATTR_SMPS_MODE", { name: "NL80211_ATTR_SMPS_MODE", value: 213, type: "integer", description: "SMPS mode to use (ap mode)" }],
  ["NL80211_ATTR_OPER_CLASS", { name: "NL80211_ATTR_OPER_CLASS", value: 214, type: "integer", description: "Operating class" }],
  ["NL80211_ATTR_MAC_MASK", { name: "NL80211_ATTR_MAC_MASK", value: 215, type: "integer", description: "MAC address mask" }],
  ["NL80211_ATTR_WIPHY_SELF_MANAGED_REG", { name: "NL80211_ATTR_WIPHY_SELF_MANAGED_REG", value: 216, type: "integer", description: "Flag attribute indicating this device is self-managing its regulatory information" }],
  ["NL80211_ATTR_EXT_FEATURES", { name: "NL80211_ATTR_EXT_FEATURES", value: 217, type: "integer", description: "Extended feature flags contained in a byte array" }],
  ["NL80211_ATTR_SURVEY_RADIO_STATS", { name: "NL80211_ATTR_SURVEY_RADIO_STATS", value: 218, type: "integer", description: "Request overall radio statistics to be returned along with other survey data" }],
  ["NL80211_ATTR_NETNS_FD", { name: "NL80211_ATTR_NETNS_FD", value: 219, type: "integer", description: "File descriptor of a network namespace" }],
  ["NL80211_ATTR_SCHED_SCAN_DELAY", { name: "NL80211_ATTR_SCHED_SCAN_DELAY", value: 220, type: "integer", description: "Delay before the first cycle of a scheduled scan is started" }],
  ["NL80211_ATTR_REG_INDOOR", { name: "NL80211_ATTR_REG_INDOOR", value: 221, type: "integer", description: "Flag attribute, if set indicates that the device is operating in an indoor environment" }],

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