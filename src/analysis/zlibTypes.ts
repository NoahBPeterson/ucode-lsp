/**
 * Zlib module type definitions and function signatures
 * Based on ucode/lib/zlib.c
 */

export interface ZlibFunctionSignature {
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

export interface ZlibConstantSignature {
  name: string;
  value: string | number;
  type: string;
  description: string;
}

export const zlibFunctions: Map<string, ZlibFunctionSignature> = new Map([
  ["deflate", {
    name: "deflate",
    parameters: [
      { name: "str_or_resource", type: "string | object", optional: false },
      { name: "gzip", type: "boolean", optional: true, defaultValue: false },
      { name: "level", type: "number", optional: true, defaultValue: "Z_DEFAULT_COMPRESSION" }
    ],
    returnType: "string | null",
    description: "Compresses data in Zlib or gzip format. If the input is a string, it is directly compressed. If an object/resource with a read() method is given, it will be read in chunks for incremental compression."
  }],
  ["inflate", {
    name: "inflate",
    parameters: [
      { name: "str_or_resource", type: "string | object", optional: false }
    ],
    returnType: "string | null",
    description: "Decompresses data in Zlib or gzip format. If the input is a string, it is directly decompressed. If an object/resource with a read() method is given, it will be read in chunks for incremental decompression."
  }],
  ["deflater", {
    name: "deflater",
    parameters: [
      { name: "gzip", type: "boolean", optional: true, defaultValue: false },
      { name: "level", type: "number", optional: true, defaultValue: "Z_DEFAULT_COMPRESSION" }
    ],
    returnType: "zlib.deflate | null",
    description: "Initializes a deflate stream for streaming compression. Returns a stream handle that can be used with write() and read() methods."
  }],
  ["inflater", {
    name: "inflater",
    parameters: [],
    returnType: "zlib.inflate | null",
    description: "Initializes an inflate stream for streaming decompression. Can process either Zlib or gzip data. Returns a stream handle that can be used with write() and read() methods."
  }]
]);

export const zlibConstants: Map<string, ZlibConstantSignature> = new Map([
  // Compression levels
  ["Z_NO_COMPRESSION", {
    name: "Z_NO_COMPRESSION",
    value: 0,
    type: "number",
    description: "No compression level - store data without compression"
  }],
  ["Z_BEST_SPEED", {
    name: "Z_BEST_SPEED", 
    value: 1,
    type: "number",
    description: "Fastest compression level with minimal compression ratio"
  }],
  ["Z_BEST_COMPRESSION", {
    name: "Z_BEST_COMPRESSION",
    value: 9,
    type: "number", 
    description: "Highest compression level with maximum compression ratio but slowest speed"
  }],
  ["Z_DEFAULT_COMPRESSION", {
    name: "Z_DEFAULT_COMPRESSION",
    value: -1,
    type: "number",
    description: "Default compromise between speed and compression (currently equivalent to level 6)"
  }],
  
  // Flush options
  ["Z_NO_FLUSH", {
    name: "Z_NO_FLUSH",
    value: 0,
    type: "number",
    description: "No flushing - accumulate data until buffer is full"
  }],
  ["Z_PARTIAL_FLUSH", {
    name: "Z_PARTIAL_FLUSH",
    value: 1,
    type: "number",
    description: "Partial flush - flush some output without closing the stream"
  }],
  ["Z_SYNC_FLUSH", {
    name: "Z_SYNC_FLUSH",
    value: 2,
    type: "number",
    description: "Sync flush - flush all pending output and align to byte boundary"
  }],
  ["Z_FULL_FLUSH", {
    name: "Z_FULL_FLUSH",
    value: 3,
    type: "number",
    description: "Full flush - flush all output and reset compression state"
  }],
  ["Z_FINISH", {
    name: "Z_FINISH",
    value: 4,
    type: "number",
    description: "Finish the stream - no more input data expected after this"
  }]
]);

export class ZlibTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(zlibFunctions.keys());
  }

  getFunction(name: string): ZlibFunctionSignature | undefined {
    return zlibFunctions.get(name);
  }

  isZlibFunction(name: string): boolean {
    return zlibFunctions.has(name);
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
    
    doc += `**Returns:** \`${func.returnType}\``;
    
    if (name === 'deflate') {
      doc += '\n\n**Example:**\n```ucode\n// deflate content using default compression\nconst deflated = deflate(content);\n\n// deflate content with gzip format and fastest compression\nconst deflated = deflate(content, true, Z_BEST_SPEED);\n```';
    } else if (name === 'inflate') {
      doc += '\n\n**Example:**\n```ucode\n// inflate compressed data\nconst inflated = inflate(compressed_data);\n```';
    } else if (name === 'deflater') {
      doc += '\n\n**Example:**\n```ucode\n// create streaming deflate\nconst zstrmd = deflater(true, Z_BEST_SPEED);\nzstrmd.write("data", Z_NO_FLUSH);\nconst compressed = zstrmd.read();\n```';
    } else if (name === 'inflater') {
      doc += '\n\n**Example:**\n```ucode\n// create streaming inflate\nconst zstrmi = inflater();\nzstrmi.write(compressed_data, Z_NO_FLUSH);\nconst decompressed = zstrmi.read();\n```';
    }
    
    return doc;
  }

  getConstantNames(): string[] {
    return Array.from(zlibConstants.keys());
  }

  getConstant(name: string): ZlibConstantSignature | undefined {
    return zlibConstants.get(name);
  }

  isZlibConstant(name: string): boolean {
    return zlibConstants.has(name);
  }

  getConstantDocumentation(name: string): string {
    const constant = this.getConstant(name);
    if (!constant) return '';
    
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  }

  // Import validation methods
  isValidImport(name: string): boolean {
    return this.isZlibFunction(name) || this.isZlibConstant(name);
  }

  getValidImports(): string[] {
    return [...this.getFunctionNames(), ...this.getConstantNames()];
  }
}

export const zlibTypeRegistry = new ZlibTypeRegistry();