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

  // WiFi Interface Types
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

  // Common NL80211 Commands (selected subset - the actual module has 100+ commands)
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

  // Hardware Simulator Commands
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
    return [...this.getFunctionNames(), ...this.getConstantNames()];
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