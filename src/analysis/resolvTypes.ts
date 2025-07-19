/**
 * Resolv module type definitions and function signatures
 * Based on ucode/lib/resolv.c
 */

export interface ResolvFunctionSignature {
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

export const resolvFunctions: Map<string, ResolvFunctionSignature> = new Map([
  ["query", {
    name: "query",
    parameters: [
      { name: "names", type: "string | string[]", optional: false },
      { name: "options", type: "object", optional: true }
    ],
    returnType: "object",
    description: "Perform DNS queries for specified domain names. Returns an object containing DNS query results organized by domain name."
  }],
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: "Get the last error message from DNS operations. Returns a descriptive error message for the last failed DNS operation, or null if no error occurred."
  }]
]);

export class ResolvTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(resolvFunctions.keys());
  }

  getFunction(name: string): ResolvFunctionSignature | undefined {
    return resolvFunctions.get(name);
  }

  isResolvFunction(name: string): boolean {
    return resolvFunctions.has(name);
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
    
    if (name === 'query') {
      doc += this.getQueryDocumentation();
    } else if (name === 'error') {
      doc += this.getErrorDocumentation();
    }
    
    if (func.parameters.length > 0) {
      doc += '**Parameters:**\n';
      func.parameters.forEach(param => {
        const optional = param.optional ? ' (optional)' : '';
        const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
        
        if (param.name === 'names') {
          doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal}) - Domain name(s) to query. Can be a single domain name string or an array of domain name strings. IP addresses can also be provided for reverse DNS lookups.\n`;
        } else if (param.name === 'options') {
          doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal}) - Query options object with the following properties:\n`;
          doc += `  - \`type\` (string[], optional) - Array of DNS record types: 'A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT', 'ANY'\n`;
          doc += `  - \`nameserver\` (string[], optional) - Array of DNS nameserver addresses (e.g., '8.8.8.8#53')\n`;
          doc += `  - \`timeout\` (number, optional, default: 5000) - Total timeout in milliseconds\n`;
          doc += `  - \`retries\` (number, optional, default: 2) - Number of retry attempts\n`;
          doc += `  - \`edns_maxsize\` (number, optional, default: 4096) - Maximum UDP packet size for EDNS\n`;
        } else {
          doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\n`;
        }
      });
      doc += '\n';
    }
    
    doc += `**Returns:** \`${func.returnType}\``;
    return doc;
  }

  private getQueryDocumentation(): string {
    return `**Supported DNS Record Types:**
- **A** - IPv4 address record
- **AAAA** - IPv6 address record  
- **CNAME** - Canonical name record
- **MX** - Mail exchange record
- **NS** - Name server record
- **PTR** - Pointer record (reverse DNS)
- **SOA** - Start of authority record
- **SRV** - Service record
- **TXT** - Text record
- **ANY** - Any available record type

**Response Codes:**
- **NOERROR** - Query successful
- **FORMERR** - Format error in query
- **SERVFAIL** - Server failure
- **NXDOMAIN** - Non-existent domain
- **NOTIMP** - Not implemented
- **REFUSED** - Query refused
- **TIMEOUT** - Query timed out

**Example:**
\`\`\`ucode
import { query } from 'resolv';

// Basic lookup
const result = query(['example.com']);

// Specific record types
const mx = query(['example.com'], { type: ['MX'] });

// Multiple domains with custom nameserver
const results = query(['example.com', 'google.com'], {
  type: ['A', 'AAAA'],
  nameserver: ['8.8.8.8'],
  timeout: 10000
});

// Reverse DNS
const ptr = query(['192.0.2.1'], { type: ['PTR'] });
\`\`\`

`;
  }

  private getErrorDocumentation(): string {
    return `**Example:**
\`\`\`ucode
import { query, error } from 'resolv';

const result = query('example.org', { nameserver: ['invalid.server'] });
const err = error();
if (err) {
  print('DNS query failed: ', err, '\\n');
}
\`\`\`

`;
  }

  // Import validation methods
  isValidImport(name: string): boolean {
    return this.isResolvFunction(name);
  }

  getValidImports(): string[] {
    return this.getFunctionNames();
  }
}

export const resolvTypeRegistry = new ResolvTypeRegistry();