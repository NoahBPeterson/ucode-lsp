/**
 * Resolv module type definitions and function signatures
 * Based on ucode/lib/resolv.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["query", {
    name: "query",
    parameters: [
      { name: "names", type: "string | string[]", optional: false },
      { name: "options", type: "object", optional: true }
    ],
    returnType: "object",
    description: `Perform DNS queries for specified domain names. Returns an object containing DNS query results organized by domain name.

Domain name(s) to query. Can be a single domain name string or an array of domain name strings. IP addresses can also be provided for reverse DNS lookups.

**Supported DNS Record Types:**
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

The \`options\` parameter is an object with the following properties:
- \`type\` (string[], optional) - Array of DNS record types: 'A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT', 'ANY'
- \`nameserver\` (string[], optional) - Array of DNS nameserver addresses (e.g., '8.8.8.8#53')
- \`timeout\` (number, optional, default: 5000) - Total timeout in milliseconds
- \`retries\` (number, optional, default: 2) - Number of retry attempts
- \`edns_maxsize\` (number, optional, default: 4096) - Maximum UDP packet size for EDNS

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
\`\`\``
  }],
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: `Get the last error message from DNS operations. Returns a descriptive error message for the last failed DNS operation, or null if no error occurred.

**Example:**
\`\`\`ucode
import { query, error } from 'resolv';

const result = query('example.org', { nameserver: ['invalid.server'] });
const err = error();
if (err) {
  print('DNS query failed: ', err, '\\n');
}
\`\`\``
  }]
]);

export const resolvModule: ModuleDefinition = {
  name: 'resolv',
  functions,
  documentation: `## Resolv Module

**DNS resolution functionality for ucode scripts**

The resolv module provides DNS resolution functionality for ucode, allowing you to perform DNS queries for various record types and handle responses.

### Usage

**Named import syntax:**
\`\`\`ucode
import { query, error } from 'resolv';

let result = query('example.com', { type: ['A'] });
if (!result) {
    let err = error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as resolv from 'resolv';

let result = resolv.query('example.com', { type: ['A'] });
if (!result) {
    let err = resolv.error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

### Available Functions

**Core operations:**
- **\`query()\`** - Perform DNS queries for specified domain names
- **\`error()\`** - Get the last error message from DNS operations

### Supported DNS Record Types

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

*Hover over individual function names for detailed parameter and return type information.*`,
};

// Backwards compatibility
export const resolvTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isResolvFunction: (name: string) => functions.has(name),
  isValidImport: (name: string) => functions.has(name),
  getValidImports: () => Array.from(functions.keys()),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('resolv', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('resolv', func);
  },
};
