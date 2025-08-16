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
  // Route table constants
  ["RT_TABLE_UNSPEC", { name: "RT_TABLE_UNSPEC", value: 0, type: "integer", description: "Unspecified routing table" }],
  ["RT_TABLE_COMPAT", { name: "RT_TABLE_COMPAT", value: 252, type: "integer", description: "Compatibility routing table" }],
  ["RT_TABLE_DEFAULT", { name: "RT_TABLE_DEFAULT", value: 253, type: "integer", description: "Default routing table" }],
  ["RT_TABLE_MAIN", { name: "RT_TABLE_MAIN", value: 254, type: "integer", description: "Main routing table" }],
  ["RT_TABLE_LOCAL", { name: "RT_TABLE_LOCAL", value: 255, type: "integer", description: "Local routing table" }],

  // Route types
  ["RTN_UNSPEC", { name: "RTN_UNSPEC", value: 0, type: "integer", description: "Unknown route type" }],
  ["RTN_UNICAST", { name: "RTN_UNICAST", value: 1, type: "integer", description: "Gateway or direct route" }],
  ["RTN_LOCAL", { name: "RTN_LOCAL", value: 2, type: "integer", description: "Accept locally" }],
  ["RTN_BROADCAST", { name: "RTN_BROADCAST", value: 3, type: "integer", description: "Accept locally as broadcast" }],
  ["RTN_ANYCAST", { name: "RTN_ANYCAST", value: 4, type: "integer", description: "Accept locally as anycast" }],
  ["RTN_MULTICAST", { name: "RTN_MULTICAST", value: 5, type: "integer", description: "Multicast route" }],
  ["RTN_BLACKHOLE", { name: "RTN_BLACKHOLE", value: 6, type: "integer", description: "Drop packets" }],
  ["RTN_UNREACHABLE", { name: "RTN_UNREACHABLE", value: 7, type: "integer", description: "Destination unreachable" }],
  ["RTN_PROHIBIT", { name: "RTN_PROHIBIT", value: 8, type: "integer", description: "Administratively prohibited" }],

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

  // RTM Commands
  ["RTM_NEWLINK", { name: "RTM_NEWLINK", value: 16, type: "integer", description: "Create new network interface" }],
  ["RTM_DELLINK", { name: "RTM_DELLINK", value: 17, type: "integer", description: "Delete network interface" }],
  ["RTM_GETLINK", { name: "RTM_GETLINK", value: 18, type: "integer", description: "Get network interface information" }],
  ["RTM_SETLINK", { name: "RTM_SETLINK", value: 19, type: "integer", description: "Set network interface configuration" }],
  ["RTM_NEWADDR", { name: "RTM_NEWADDR", value: 20, type: "integer", description: "Add new address" }],
  ["RTM_DELADDR", { name: "RTM_DELADDR", value: 21, type: "integer", description: "Delete address" }],
  ["RTM_GETADDR", { name: "RTM_GETADDR", value: 22, type: "integer", description: "Get address information" }],
  ["RTM_NEWROUTE", { name: "RTM_NEWROUTE", value: 24, type: "integer", description: "Add new route" }],
  ["RTM_DELROUTE", { name: "RTM_DELROUTE", value: 25, type: "integer", description: "Delete route" }],
  ["RTM_GETROUTE", { name: "RTM_GETROUTE", value: 26, type: "integer", description: "Get route information" }],

  // Routing Multicast Groups
  ["RTNLGRP_LINK", { name: "RTNLGRP_LINK", value: 1, type: "integer", description: "Link layer multicast group" }],
  ["RTNLGRP_NOTIFY", { name: "RTNLGRP_NOTIFY", value: 2, type: "integer", description: "Routing notify multicast group" }],
  ["RTNLGRP_NEIGH", { name: "RTNLGRP_NEIGH", value: 3, type: "integer", description: "Neighbor multicast group" }],
  ["RTNLGRP_TC", { name: "RTNLGRP_TC", value: 4, type: "integer", description: "Traffic control multicast group" }],
  ["RTNLGRP_IPV4_IFADDR", { name: "RTNLGRP_IPV4_IFADDR", value: 5, type: "integer", description: "IPv4 interface address multicast group" }],
  ["RTNLGRP_IPV4_MROUTE", { name: "RTNLGRP_IPV4_MROUTE", value: 6, type: "integer", description: "IPv4 multicast route group" }],
  ["RTNLGRP_IPV4_ROUTE", { name: "RTNLGRP_IPV4_ROUTE", value: 7, type: "integer", description: "IPv4 route multicast group" }],
  ["RTNLGRP_IPV6_IFADDR", { name: "RTNLGRP_IPV6_IFADDR", value: 9, type: "integer", description: "IPv6 interface address multicast group" }],
  ["RTNLGRP_IPV6_ROUTE", { name: "RTNLGRP_IPV6_ROUTE", value: 11, type: "integer", description: "IPv6 route multicast group" }]
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
    let doc = `**${signature}**\\n\\n${func.description}\\n\\n`;
    
    if (func.parameters.length > 0) {
      doc += '**Parameters:**\\n';
      func.parameters.forEach(param => {
        const optional = param.optional ? ' (optional)' : '';
        const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
        doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\\n`;
      });
      doc += '\\n';
    }
    
    doc += `**Returns:** \`${func.returnType}\`\\n\\n`;
    
    // Add usage examples
    if (name === 'request') {
      doc += '**Example:**\\n```ucode\\n// Get all routes\\nlet routes = request(RTM_GETROUTE, NLM_F_DUMP);\\n\\n// Add a new route\\nlet result = request(RTM_NEWROUTE, NLM_F_CREATE | NLM_F_EXCL, {\\n    dst: "192.168.1.0/24",\\n    gateway: "192.168.1.1",\\n    oif: 2\\n});\\n```';
    } else if (name === 'listener') {
      doc += '**Example:**\\n```ucode\\n// Listen for route changes\\nlet l = listener(function(msg) {\\n  printf("Route event: %J\\\\n", msg);\\n}, [RTM_NEWROUTE, RTM_DELROUTE]);\\n\\n// Listen for link changes\\nlet linkListener = listener(function(msg) {\\n  printf("Link event: %J\\\\n", msg);\\n}, [RTM_NEWLINK, RTM_DELLINK]);\\n```';
    } else if (name === 'error') {
      doc += '**Example:**\\n```ucode\\nlet result = request(RTM_GETROUTE, NLM_F_DUMP);\\nif (!result) {\\n    let errorMsg = error();\\n    printf("RTNL error: %s\\\\n", errorMsg);\\n}\\n```';
    }
    
    return doc;
  }

  getConstantDocumentation(name: string): string {
    const constant = this.getConstant(name);
    if (!constant) return '';
    
    return `**${constant.name}** = \`${constant.value}\`\\n\\n*${constant.type}*\\n\\n${constant.description}`;
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