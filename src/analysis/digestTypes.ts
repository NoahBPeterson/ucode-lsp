/**
 * Digest module type definitions and function signatures
 * Based on ucode/lib/digest.c
 */

export interface DigestFunctionSignature {
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

export const digestFunctions: Map<string, DigestFunctionSignature> = new Map([
  ["md5", {
    name: "md5",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD5 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["sha1", {
    name: "sha1",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA1 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["sha256", {
    name: "sha256",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA256 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["md5_file", {
    name: "md5_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD5 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  
  ["sha1_file", {
    name: "sha1_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA1 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  
  ["sha256_file", {
    name: "sha256_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA256 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  
  // Extended functions (conditional compilation)
  ["md2", {
    name: "md2",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD2 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["md4", {
    name: "md4",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD4 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["sha384", {
    name: "sha384",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA384 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["sha512", {
    name: "sha512",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA512 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  
  ["md2_file", {
    name: "md2_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD2 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  
  ["md4_file", {
    name: "md4_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD4 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  
  ["sha384_file", {
    name: "sha384_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA384 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  
  ["sha512_file", {
    name: "sha512_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA512 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }]
]);

export class DigestTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(digestFunctions.keys());
  }

  getFunction(name: string): DigestFunctionSignature | undefined {
    return digestFunctions.get(name);
  }

  isDigestFunction(name: string): boolean {
    return digestFunctions.has(name);
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
    
    // Add examples based on function type
    if (name.includes('_file')) {
      doc += `**Example:**\n\`\`\`ucode\n${name}("/path/to/file.txt");  // Returns hash string or null\n\`\`\``;
    } else {
      doc += `**Example:**\n\`\`\`ucode\n${name}("This is a test");  // Returns hash string\n${name}(123);               // Returns null\n\`\`\``;
    }
    
    return doc;
  }
}

export const digestTypeRegistry = new DigestTypeRegistry();