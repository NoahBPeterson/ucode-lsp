/**
 * Type definitions and registry for rtnl module
 * Based on ucode/lib/rtnl.c
 */

export interface RtnlConstant {
    type: string;
    value: number | string;
    description: string;
}

class RtnlTypeRegistry {
    private constants = new Map<string, RtnlConstant>();
    private functions = new Map<string, any>();

    constructor() {
        this.initializeConstants();
        this.initializeFunctions();
    }

    private initializeConstants(): void {
        // Route table constants
        this.addConstant('RT_TABLE_UNSPEC', { type: 'number', value: 0, description: 'Unspecified routing table' });
        this.addConstant('RT_TABLE_COMPAT', { type: 'number', value: 252, description: 'Compatibility routing table' });
        this.addConstant('RT_TABLE_DEFAULT', { type: 'number', value: 253, description: 'Default routing table' });
        this.addConstant('RT_TABLE_MAIN', { type: 'number', value: 254, description: 'Main routing table' });
        this.addConstant('RT_TABLE_LOCAL', { type: 'number', value: 255, description: 'Local routing table' });

        // Route types
        this.addConstant('RTN_UNSPEC', { type: 'number', value: 0, description: 'Unknown route type' });
        this.addConstant('RTN_UNICAST', { type: 'number', value: 1, description: 'Gateway or direct route' });
        this.addConstant('RTN_LOCAL', { type: 'number', value: 2, description: 'Accept locally' });
        this.addConstant('RTN_BROADCAST', { type: 'number', value: 3, description: 'Accept locally as broadcast' });
        this.addConstant('RTN_ANYCAST', { type: 'number', value: 4, description: 'Accept locally as anycast' });
        this.addConstant('RTN_MULTICAST', { type: 'number', value: 5, description: 'Multicast route' });
        this.addConstant('RTN_BLACKHOLE', { type: 'number', value: 6, description: 'Drop packets' });
        this.addConstant('RTN_UNREACHABLE', { type: 'number', value: 7, description: 'Destination unreachable' });
        this.addConstant('RTN_PROHIBIT', { type: 'number', value: 8, description: 'Administratively prohibited' });

        // Bridge constants
        this.addConstant('BRIDGE_FLAGS_MASTER', { type: 'number', value: 1, description: 'Bridge master flag' });
        this.addConstant('BRIDGE_FLAGS_SELF', { type: 'number', value: 2, description: 'Bridge self flag' });
        
        // Add more constants as needed...
    }

    private initializeFunctions(): void {
        this.functions.set('request', { 
            params: ['cmd', 'flags', 'payload'], 
            description: '**request(cmd, flags?, payload?)** - Send a netlink request to the routing subsystem.\n\n**Parameters:**\n- `cmd` (integer): The RTM_* command to execute\n- `flags` (integer, optional): Request flags (NLM_F_*)\n- `payload` (object, optional): Command-specific attributes\n\n**Returns:** `object | null` - The response object or null on error\n\n**Example:**\n```ucode\n// Get all routes\nlet routes = request(RTM_GETROUTE, NLM_F_DUMP);\n\n// Add a new route\nlet result = request(RTM_NEWROUTE, NLM_F_CREATE | NLM_F_EXCL, {\n    dst: "192.168.1.0/24",\n    gateway: "192.168.1.1",\n    oif: 2\n});\n```'
        });
        this.functions.set('listener', { 
            params: ['callback', 'cmds', 'groups'], 
            description: '**listener(callback, cmds?, groups?)** - Create an event listener for routing netlink messages.\n\n**Parameters:**\n- `callback` (function): Function called when events are received\n- `cmds` (array, optional): Array of RTM_* command constants to listen for\n- `groups` (array, optional): Array of multicast groups to join\n\n**Returns:** `rtnl.listener` - Listener object with set_commands() and close() methods\n\n**Example:**\n```ucode\n// Listen for route changes\nlet l = listener(function(msg) {\n    printf("Route event: %J\\n", msg);\n}, [RTM_NEWROUTE, RTM_DELROUTE], [RTNLGRP_IPV4_ROUTE]);\n\n// Listen for link changes\nlet linkListener = listener(function(msg) {\n    printf("Link event: %J\\n", msg);\n}, [RTM_NEWLINK, RTM_DELLINK]);\n```'
        });
        this.functions.set('error', { 
            params: [], 
            description: '**error()** - Get the last error message from rtnl operations.\n\n**Returns:** `string | null` - Error description or null if no error occurred\n\n**Example:**\n```ucode\nlet result = request(RTM_GETROUTE, NLM_F_DUMP);\nif (!result) {\n    let errorMsg = error();\n    printf("RTNL error: %s\\n", errorMsg);\n}\n```'
        });
    }

    getFunctionDocumentation(name: string): string {
        const func = this.functions.get(name);
        if (!func) return '';
        
        return func.description;
    }

    private addConstant(name: string, constant: RtnlConstant): void {
        this.constants.set(name, constant);
    }

    getConstant(name: string): RtnlConstant | undefined {
        return this.constants.get(name);
    }

    getConstantNames(): string[] {
        return Array.from(this.constants.keys());
    }

    getFunctionNames(): string[] {
        return Array.from(this.functions.keys());
    }

    getValidImports(): string[] {
        return [...this.getFunctionNames(), ...this.getConstantNames(), 'const'];
    }

    isValidRtnlImport(importName: string): boolean {
        return this.getValidImports().includes(importName);
    }

    getConstantDocumentation(name: string): string {
        const constant = this.constants.get(name);
        if (!constant) return '';
        
        return `**${name}**\n\n${constant.description}\n\n- Type: \`${constant.type}\`\n- Value: \`${constant.value}\``;
    }
}

export const rtnlTypeRegistry = new RtnlTypeRegistry();