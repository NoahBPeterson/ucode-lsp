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
  ["NLM_F_ACK", { name: "NLM_F_ACK", value: 4, type: "integer", description: "Request an acknowledgment on errors" }],
  ["NLM_F_ACK_TLVS", { name: "NLM_F_ACK_TLVS", value: 512, type: "integer", description: "Extended ACK TLVs were included" }],
  ["NLM_F_APPEND", { name: "NLM_F_APPEND", value: 2048, type: "integer", description: "Append the new entry to the end of the list" }],
  ["NLM_F_ATOMIC", { name: "NLM_F_ATOMIC", value: 1024, type: "integer", description: "Use atomic operations" }],
  ["NLM_F_CAPPED", { name: "NLM_F_CAPPED", value: 256, type: "integer", description: "Dump was capped" }],
  ["NLM_F_CREATE", { name: "NLM_F_CREATE", value: 1024, type: "integer", description: "Create if it does not exist" }],
  ["NLM_F_DUMP", { name: "NLM_F_DUMP", value: 768, type: "integer", description: "Dump the table" }],
  ["NLM_F_DUMP_FILTERED", { name: "NLM_F_DUMP_FILTERED", value: 32, type: "integer", description: "Dump was filtered" }],
  ["NLM_F_DUMP_INTR", { name: "NLM_F_DUMP_INTR", value: 16, type: "integer", description: "Dump was interrupted" }],
  ["NLM_F_ECHO", { name: "NLM_F_ECHO", value: 8, type: "integer", description: "Echo this request" }],
  ["NLM_F_EXCL", { name: "NLM_F_EXCL", value: 512, type: "integer", description: "Do not touch, if it exists" }],
  ["NLM_F_MATCH", { name: "NLM_F_MATCH", value: 512, type: "integer", description: "Dump all matching entries" }],
  ["NLM_F_MULTI", { name: "NLM_F_MULTI", value: 2, type: "integer", description: "Multipart message" }],
  ["NLM_F_NONREC", { name: "NLM_F_NONREC", value: 256, type: "integer", description: "Do not delete recursively" }],
  ["NLM_F_REPLACE", { name: "NLM_F_REPLACE", value: 256, type: "integer", description: "Replace existing matching object" }],
  ["NLM_F_REQUEST", { name: "NLM_F_REQUEST", value: 1, type: "integer", description: "This message is a request" }],
  ["NLM_F_ROOT", { name: "NLM_F_ROOT", value: 256, type: "integer", description: "Specify tree root" }],

  // NL80211 Commands
  ["NL80211_CMD_GET_WIPHY", { name: "NL80211_CMD_GET_WIPHY", value: 1, type: "integer", description: "Get wireless physical device info" }],
  ["NL80211_CMD_SET_WIPHY", { name: "NL80211_CMD_SET_WIPHY", value: 2, type: "integer", description: "Set wireless physical device configuration" }],
  ["NL80211_CMD_NEW_WIPHY", { name: "NL80211_CMD_NEW_WIPHY", value: 3, type: "integer", description: "Create new wireless physical device" }],
  ["NL80211_CMD_DEL_WIPHY", { name: "NL80211_CMD_DEL_WIPHY", value: 4, type: "integer", description: "Delete wireless physical device" }],
  ["NL80211_CMD_GET_INTERFACE", { name: "NL80211_CMD_GET_INTERFACE", value: 5, type: "integer", description: "Get wireless interface info" }],
  ["NL80211_CMD_SET_INTERFACE", { name: "NL80211_CMD_SET_INTERFACE", value: 6, type: "integer", description: "Set wireless interface configuration" }],
  ["NL80211_CMD_NEW_INTERFACE", { name: "NL80211_CMD_NEW_INTERFACE", value: 7, type: "integer", description: "Create new wireless interface" }],
  ["NL80211_CMD_DEL_INTERFACE", { name: "NL80211_CMD_DEL_INTERFACE", value: 8, type: "integer", description: "Delete wireless interface" }],
  ["NL80211_CMD_GET_KEY", { name: "NL80211_CMD_GET_KEY", value: 9, type: "integer", description: "Get encryption key" }],
  ["NL80211_CMD_SET_KEY", { name: "NL80211_CMD_SET_KEY", value: 10, type: "integer", description: "Set encryption key" }],
  ["NL80211_CMD_NEW_KEY", { name: "NL80211_CMD_NEW_KEY", value: 11, type: "integer", description: "Add new encryption key" }],
  ["NL80211_CMD_DEL_KEY", { name: "NL80211_CMD_DEL_KEY", value: 12, type: "integer", description: "Delete encryption key" }],
  ["NL80211_CMD_GET_BEACON", { name: "NL80211_CMD_GET_BEACON", value: 13, type: "integer", description: "Get beacon information" }],
  ["NL80211_CMD_SET_BEACON", { name: "NL80211_CMD_SET_BEACON", value: 14, type: "integer", description: "Set beacon configuration" }],
  ["NL80211_CMD_START_AP", { name: "NL80211_CMD_START_AP", value: 15, type: "integer", description: "Start access point" }],
  ["NL80211_CMD_NEW_BEACON", { name: "NL80211_CMD_NEW_BEACON", value: 15, type: "integer", description: "New beacon (alias for START_AP)" }],
  ["NL80211_CMD_STOP_AP", { name: "NL80211_CMD_STOP_AP", value: 16, type: "integer", description: "Stop access point" }],
  ["NL80211_CMD_DEL_BEACON", { name: "NL80211_CMD_DEL_BEACON", value: 16, type: "integer", description: "Delete beacon (alias for STOP_AP)" }],
  ["NL80211_CMD_GET_STATION", { name: "NL80211_CMD_GET_STATION", value: 17, type: "integer", description: "Get station information" }],
  ["NL80211_CMD_SET_STATION", { name: "NL80211_CMD_SET_STATION", value: 18, type: "integer", description: "Set station configuration" }],
  ["NL80211_CMD_NEW_STATION", { name: "NL80211_CMD_NEW_STATION", value: 19, type: "integer", description: "Add new station" }],
  ["NL80211_CMD_DEL_STATION", { name: "NL80211_CMD_DEL_STATION", value: 20, type: "integer", description: "Delete station" }],
  ["NL80211_CMD_GET_MPATH", { name: "NL80211_CMD_GET_MPATH", value: 21, type: "integer", description: "Get mesh path" }],
  ["NL80211_CMD_SET_MPATH", { name: "NL80211_CMD_SET_MPATH", value: 22, type: "integer", description: "Set mesh path" }],
  ["NL80211_CMD_NEW_MPATH", { name: "NL80211_CMD_NEW_MPATH", value: 23, type: "integer", description: "Add new mesh path" }],
  ["NL80211_CMD_DEL_MPATH", { name: "NL80211_CMD_DEL_MPATH", value: 24, type: "integer", description: "Delete mesh path" }],
  ["NL80211_CMD_SET_BSS", { name: "NL80211_CMD_SET_BSS", value: 25, type: "integer", description: "Set BSS configuration" }],
  ["NL80211_CMD_SET_REG", { name: "NL80211_CMD_SET_REG", value: 26, type: "integer", description: "Set regulatory domain" }],
  ["NL80211_CMD_REQ_SET_REG", { name: "NL80211_CMD_REQ_SET_REG", value: 27, type: "integer", description: "Request regulatory domain setting" }],
  ["NL80211_CMD_GET_MESH_CONFIG", { name: "NL80211_CMD_GET_MESH_CONFIG", value: 28, type: "integer", description: "Get mesh configuration" }],
  ["NL80211_CMD_SET_MESH_CONFIG", { name: "NL80211_CMD_SET_MESH_CONFIG", value: 29, type: "integer", description: "Set mesh configuration" }],
  ["NL80211_CMD_GET_REG", { name: "NL80211_CMD_GET_REG", value: 31, type: "integer", description: "Get regulatory domain" }],
  ["NL80211_CMD_GET_SCAN", { name: "NL80211_CMD_GET_SCAN", value: 32, type: "integer", description: "Get scan results" }],
  ["NL80211_CMD_TRIGGER_SCAN", { name: "NL80211_CMD_TRIGGER_SCAN", value: 33, type: "integer", description: "Trigger wireless scan" }],
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
  ["NL80211_CMD_TESTMODE", { name: "NL80211_CMD_TESTMODE", value: 45, type: "integer", description: "Enter test mode" }],
  ["NL80211_CMD_CONNECT", { name: "NL80211_CMD_CONNECT", value: 46, type: "integer", description: "Connect to network" }],
  ["NL80211_CMD_ROAM", { name: "NL80211_CMD_ROAM", value: 47, type: "integer", description: "Roaming event" }],
  ["NL80211_CMD_DISCONNECT", { name: "NL80211_CMD_DISCONNECT", value: 48, type: "integer", description: "Disconnect from network" }],
  ["NL80211_CMD_SET_WIPHY_NETNS", { name: "NL80211_CMD_SET_WIPHY_NETNS", value: 49, type: "integer", description: "Set wiphy network namespace" }],
  ["NL80211_CMD_GET_SURVEY", { name: "NL80211_CMD_GET_SURVEY", value: 50, type: "integer", description: "Get channel survey" }],
  ["NL80211_CMD_NEW_SURVEY_RESULTS", { name: "NL80211_CMD_NEW_SURVEY_RESULTS", value: 51, type: "integer", description: "New survey results" }],
  ["NL80211_CMD_SET_PMKSA", { name: "NL80211_CMD_SET_PMKSA", value: 52, type: "integer", description: "Set PMKSA cache entry" }],
  ["NL80211_CMD_DEL_PMKSA", { name: "NL80211_CMD_DEL_PMKSA", value: 53, type: "integer", description: "Delete PMKSA cache entry" }],
  ["NL80211_CMD_FLUSH_PMKSA", { name: "NL80211_CMD_FLUSH_PMKSA", value: 54, type: "integer", description: "Flush PMKSA cache" }],
  ["NL80211_CMD_REMAIN_ON_CHANNEL", { name: "NL80211_CMD_REMAIN_ON_CHANNEL", value: 55, type: "integer", description: "Remain on channel" }],
  ["NL80211_CMD_CANCEL_REMAIN_ON_CHANNEL", { name: "NL80211_CMD_CANCEL_REMAIN_ON_CHANNEL", value: 56, type: "integer", description: "Cancel remain on channel" }],
  ["NL80211_CMD_SET_TX_BITRATE_MASK", { name: "NL80211_CMD_SET_TX_BITRATE_MASK", value: 57, type: "integer", description: "Set TX bitrate mask" }],
  ["NL80211_CMD_REGISTER_FRAME", { name: "NL80211_CMD_REGISTER_FRAME", value: 58, type: "integer", description: "Register for frame events" }],
  ["NL80211_CMD_REGISTER_ACTION", { name: "NL80211_CMD_REGISTER_ACTION", value: 58, type: "integer", description: "Register for action frame events" }],
  ["NL80211_CMD_FRAME", { name: "NL80211_CMD_FRAME", value: 59, type: "integer", description: "Frame event" }],
  ["NL80211_CMD_ACTION", { name: "NL80211_CMD_ACTION", value: 59, type: "integer", description: "Action frame event" }],
  ["NL80211_CMD_FRAME_TX_STATUS", { name: "NL80211_CMD_FRAME_TX_STATUS", value: 60, type: "integer", description: "Frame TX status" }],
  ["NL80211_CMD_ACTION_TX_STATUS", { name: "NL80211_CMD_ACTION_TX_STATUS", value: 60, type: "integer", description: "Action frame TX status" }],
  ["NL80211_CMD_SET_POWER_SAVE", { name: "NL80211_CMD_SET_POWER_SAVE", value: 61, type: "integer", description: "Set power save mode" }],
  ["NL80211_CMD_GET_POWER_SAVE", { name: "NL80211_CMD_GET_POWER_SAVE", value: 62, type: "integer", description: "Get power save mode" }],
  ["NL80211_CMD_SET_CQM", { name: "NL80211_CMD_SET_CQM", value: 63, type: "integer", description: "Set connection quality monitoring" }],
  ["NL80211_CMD_NOTIFY_CQM", { name: "NL80211_CMD_NOTIFY_CQM", value: 64, type: "integer", description: "Connection quality monitoring notification" }],
  ["NL80211_CMD_SET_CHANNEL", { name: "NL80211_CMD_SET_CHANNEL", value: 65, type: "integer", description: "Set channel" }],
  ["NL80211_CMD_SET_WDS_PEER", { name: "NL80211_CMD_SET_WDS_PEER", value: 66, type: "integer", description: "Set WDS peer" }],
  ["NL80211_CMD_FRAME_WAIT_CANCEL", { name: "NL80211_CMD_FRAME_WAIT_CANCEL", value: 67, type: "integer", description: "Cancel frame wait" }],
  ["NL80211_CMD_JOIN_MESH", { name: "NL80211_CMD_JOIN_MESH", value: 68, type: "integer", description: "Join mesh network" }],
  ["NL80211_CMD_LEAVE_MESH", { name: "NL80211_CMD_LEAVE_MESH", value: 69, type: "integer", description: "Leave mesh network" }],
  ["NL80211_CMD_UNPROT_DEAUTHENTICATE", { name: "NL80211_CMD_UNPROT_DEAUTHENTICATE", value: 70, type: "integer", description: "Unprotected deauthentication" }],
  ["NL80211_CMD_UNPROT_DISASSOCIATE", { name: "NL80211_CMD_UNPROT_DISASSOCIATE", value: 71, type: "integer", description: "Unprotected disassociation" }],
  ["NL80211_CMD_NEW_PEER_CANDIDATE", { name: "NL80211_CMD_NEW_PEER_CANDIDATE", value: 72, type: "integer", description: "New peer candidate" }],
  ["NL80211_CMD_GET_WOWLAN", { name: "NL80211_CMD_GET_WOWLAN", value: 73, type: "integer", description: "Get Wake-on-WLAN configuration" }],
  ["NL80211_CMD_SET_WOWLAN", { name: "NL80211_CMD_SET_WOWLAN", value: 74, type: "integer", description: "Set Wake-on-WLAN configuration" }],
  ["NL80211_CMD_START_SCHED_SCAN", { name: "NL80211_CMD_START_SCHED_SCAN", value: 75, type: "integer", description: "Start scheduled scan" }],
  ["NL80211_CMD_STOP_SCHED_SCAN", { name: "NL80211_CMD_STOP_SCHED_SCAN", value: 76, type: "integer", description: "Stop scheduled scan" }],
  ["NL80211_CMD_SCHED_SCAN_RESULTS", { name: "NL80211_CMD_SCHED_SCAN_RESULTS", value: 77, type: "integer", description: "Scheduled scan results" }],
  ["NL80211_CMD_SCHED_SCAN_STOPPED", { name: "NL80211_CMD_SCHED_SCAN_STOPPED", value: 78, type: "integer", description: "Scheduled scan stopped" }],
  ["NL80211_CMD_SET_REKEY_OFFLOAD", { name: "NL80211_CMD_SET_REKEY_OFFLOAD", value: 79, type: "integer", description: "Set rekey offload" }],
  ["NL80211_CMD_PMKSA_CANDIDATE", { name: "NL80211_CMD_PMKSA_CANDIDATE", value: 80, type: "integer", description: "PMKSA candidate" }],
  ["NL80211_CMD_TDLS_OPER", { name: "NL80211_CMD_TDLS_OPER", value: 81, type: "integer", description: "TDLS operation" }],
  ["NL80211_CMD_TDLS_MGMT", { name: "NL80211_CMD_TDLS_MGMT", value: 82, type: "integer", description: "TDLS management" }],
  ["NL80211_CMD_UNEXPECTED_FRAME", { name: "NL80211_CMD_UNEXPECTED_FRAME", value: 83, type: "integer", description: "Unexpected frame received" }],
  ["NL80211_CMD_PROBE_CLIENT", { name: "NL80211_CMD_PROBE_CLIENT", value: 84, type: "integer", description: "Probe client" }],
  ["NL80211_CMD_REGISTER_BEACONS", { name: "NL80211_CMD_REGISTER_BEACONS", value: 85, type: "integer", description: "Register for beacon events" }],
  ["NL80211_CMD_UNEXPECTED_4ADDR_FRAME", { name: "NL80211_CMD_UNEXPECTED_4ADDR_FRAME", value: 86, type: "integer", description: "Unexpected 4-address frame" }],
  ["NL80211_CMD_SET_NOACK_MAP", { name: "NL80211_CMD_SET_NOACK_MAP", value: 87, type: "integer", description: "Set no-ACK map" }],
  ["NL80211_CMD_CH_SWITCH_NOTIFY", { name: "NL80211_CMD_CH_SWITCH_NOTIFY", value: 88, type: "integer", description: "Channel switch notification" }],
  ["NL80211_CMD_START_P2P_DEVICE", { name: "NL80211_CMD_START_P2P_DEVICE", value: 89, type: "integer", description: "Start P2P device" }],
  ["NL80211_CMD_STOP_P2P_DEVICE", { name: "NL80211_CMD_STOP_P2P_DEVICE", value: 90, type: "integer", description: "Stop P2P device" }],
  ["NL80211_CMD_CONN_FAILED", { name: "NL80211_CMD_CONN_FAILED", value: 91, type: "integer", description: "Connection failed" }],
  ["NL80211_CMD_SET_MCAST_RATE", { name: "NL80211_CMD_SET_MCAST_RATE", value: 92, type: "integer", description: "Set multicast rate" }],
  ["NL80211_CMD_SET_MAC_ACL", { name: "NL80211_CMD_SET_MAC_ACL", value: 93, type: "integer", description: "Set MAC ACL" }],
  ["NL80211_CMD_RADAR_DETECT", { name: "NL80211_CMD_RADAR_DETECT", value: 94, type: "integer", description: "Radar detection" }],
  ["NL80211_CMD_GET_PROTOCOL_FEATURES", { name: "NL80211_CMD_GET_PROTOCOL_FEATURES", value: 95, type: "integer", description: "Get protocol features" }],
  ["NL80211_CMD_UPDATE_FT_IES", { name: "NL80211_CMD_UPDATE_FT_IES", value: 96, type: "integer", description: "Update fast transition IEs" }],
  ["NL80211_CMD_FT_EVENT", { name: "NL80211_CMD_FT_EVENT", value: 97, type: "integer", description: "Fast transition event" }],
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
  ["NL80211_CMD_JOIN_OCB", { name: "NL80211_CMD_JOIN_OCB", value: 108, type: "integer", description: "Join OCB network" }],
  ["NL80211_CMD_LEAVE_OCB", { name: "NL80211_CMD_LEAVE_OCB", value: 109, type: "integer", description: "Leave OCB network" }],
  ["NL80211_CMD_CH_SWITCH_STARTED_NOTIFY", { name: "NL80211_CMD_CH_SWITCH_STARTED_NOTIFY", value: 110, type: "integer", description: "Channel switch started notification" }],
  ["NL80211_CMD_TDLS_CHANNEL_SWITCH", { name: "NL80211_CMD_TDLS_CHANNEL_SWITCH", value: 111, type: "integer", description: "TDLS channel switch" }],
  ["NL80211_CMD_TDLS_CANCEL_CHANNEL_SWITCH", { name: "NL80211_CMD_TDLS_CANCEL_CHANNEL_SWITCH", value: 112, type: "integer", description: "Cancel TDLS channel switch" }],

  // NL80211 Interface Types
  ["NL80211_IFTYPE_ADHOC", { name: "NL80211_IFTYPE_ADHOC", value: 1, type: "integer", description: "Ad-hoc network interface" }],
  ["NL80211_IFTYPE_STATION", { name: "NL80211_IFTYPE_STATION", value: 2, type: "integer", description: "Station interface" }],
  ["NL80211_IFTYPE_AP", { name: "NL80211_IFTYPE_AP", value: 3, type: "integer", description: "Access point interface" }],
  ["NL80211_IFTYPE_AP_VLAN", { name: "NL80211_IFTYPE_AP_VLAN", value: 4, type: "integer", description: "AP VLAN interface" }],
  ["NL80211_IFTYPE_WDS", { name: "NL80211_IFTYPE_WDS", value: 5, type: "integer", description: "Wireless distribution system interface" }],
  ["NL80211_IFTYPE_MONITOR", { name: "NL80211_IFTYPE_MONITOR", value: 6, type: "integer", description: "Monitor interface" }],
  ["NL80211_IFTYPE_MESH_POINT", { name: "NL80211_IFTYPE_MESH_POINT", value: 7, type: "integer", description: "Mesh point interface" }],
  ["NL80211_IFTYPE_P2P_CLIENT", { name: "NL80211_IFTYPE_P2P_CLIENT", value: 8, type: "integer", description: "P2P client interface" }],
  ["NL80211_IFTYPE_P2P_GO", { name: "NL80211_IFTYPE_P2P_GO", value: 9, type: "integer", description: "P2P group owner interface" }],
  ["NL80211_IFTYPE_P2P_DEVICE", { name: "NL80211_IFTYPE_P2P_DEVICE", value: 10, type: "integer", description: "P2P device interface" }],
  ["NL80211_IFTYPE_OCB", { name: "NL80211_IFTYPE_OCB", value: 11, type: "integer", description: "Outside context of BSS interface" }],

  // HWSIM Commands
  ["HWSIM_CMD_REGISTER", { name: "HWSIM_CMD_REGISTER", value: 1, type: "integer", description: "Register hwsim instance" }],
  ["HWSIM_CMD_FRAME", { name: "HWSIM_CMD_FRAME", value: 2, type: "integer", description: "Frame transmission/reception" }],
  ["HWSIM_CMD_TX_INFO_FRAME", { name: "HWSIM_CMD_TX_INFO_FRAME", value: 3, type: "integer", description: "TX info frame" }],
  ["HWSIM_CMD_NEW_RADIO", { name: "HWSIM_CMD_NEW_RADIO", value: 4, type: "integer", description: "Create new radio" }],
  ["HWSIM_CMD_DEL_RADIO", { name: "HWSIM_CMD_DEL_RADIO", value: 5, type: "integer", description: "Delete radio" }],
  ["HWSIM_CMD_GET_RADIO", { name: "HWSIM_CMD_GET_RADIO", value: 6, type: "integer", description: "Get radio information" }],
  ["HWSIM_CMD_ADD_MAC_ADDR", { name: "HWSIM_CMD_ADD_MAC_ADDR", value: 7, type: "integer", description: "Add MAC address" }],
  ["HWSIM_CMD_DEL_MAC_ADDR", { name: "HWSIM_CMD_DEL_MAC_ADDR", value: 8, type: "integer", description: "Delete MAC address" }],
  ["HWSIM_CMD_START_PMSR", { name: "HWSIM_CMD_START_PMSR", value: 9, type: "integer", description: "Start peer measurement" }],
  ["HWSIM_CMD_ABORT_PMSR", { name: "HWSIM_CMD_ABORT_PMSR", value: 10, type: "integer", description: "Abort peer measurement" }],
  ["HWSIM_CMD_REPORT_PMSR", { name: "HWSIM_CMD_REPORT_PMSR", value: 11, type: "integer", description: "Report peer measurement" }]
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
      doc += '**Example:**\n```ucode\n// Get wiphy information\nlet wiphy = request(NL80211_CMD_GET_WIPHY, NLM_F_DUMP);\n\n// Start access point\nlet result = request(NL80211_CMD_START_AP, NLM_F_ACK, {\n    ssid: "MyAP",\n    channel: 6\n});\n```';
    } else if (name === 'listener') {
      doc += '**Example:**\n```ucode\n// Listen for scan results\nlet l = listener(function(msg) {\n  printf("Scan event: %J\\n", msg);\n}, [NL80211_CMD_NEW_SCAN_RESULTS]);\n\n// Listen for connection events\nlet connListener = listener(function(msg) {\n  printf("Connection event: %J\\n", msg);\n}, [NL80211_CMD_CONNECT, NL80211_CMD_DISCONNECT]);\n```';
    } else if (name === 'waitfor') {
      doc += '**Example:**\n```ucode\n// Wait for scan completion\nlet result = waitfor([NL80211_CMD_NEW_SCAN_RESULTS, NL80211_CMD_SCAN_ABORTED], 5000);\nif (result) {\n    printf("Scan completed: %J\\n", result);\n} else {\n    printf("Scan timeout\\n");\n}\n```';
    } else if (name === 'error') {
      doc += '**Example:**\n```ucode\nlet result = request(NL80211_CMD_GET_WIPHY);\nif (!result) {\n    let errorMsg = error();\n    printf("NL80211 error: %s\\n", errorMsg);\n}\n```';
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
    defaultValue?: any;
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
    // Initialize nl80211.listener type with its methods
    const listenerMethods = new Map<string, Nl80211FunctionSignature>([
      ['set_commands', {
        name: 'set_commands',
        parameters: [
          { name: 'cmds', type: 'array', optional: false }
        ],
        returnType: 'null',
        description: 'Set the list of NL80211_CMD_* commands to listen for.'
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

  public getNl80211MethodNames(typeName: string): string[] {
    const nl80211Type = this.getNl80211Type(typeName);
    return nl80211Type ? Array.from(nl80211Type.methods.keys()) : [];
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