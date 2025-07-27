/**
 * Struct module type definitions and function signatures
 * Based on ucode/lib/struct.c
 */

export interface StructFunctionSignature {
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

export const structFunctions: Map<string, StructFunctionSignature> = new Map([
  ["pack", {
    name: "pack",
    parameters: [
      { name: "format", type: "string", optional: false },
      { name: "values", type: "any", optional: false }
    ],
    returnType: "string",
    description: "Pack given values according to specified format. Creates a byte string containing the argument values packed according to the given format string."
  }],
  ["unpack", {
    name: "unpack",
    parameters: [
      { name: "format", type: "string", optional: false },
      { name: "input", type: "string", optional: false },
      { name: "offset", type: "number", optional: true, defaultValue: 0 }
    ],
    returnType: "array",
    description: "Unpack given byte string according to specified format. Interprets a byte string according to the given format string and returns the resulting values."
  }],
  ["new", {
    name: "new",
    parameters: [
      { name: "format", type: "string", optional: false }
    ],
    returnType: "struct.instance",
    description: "Precompile format string. Returns a struct object instance useful for packing and unpacking multiple items without having to recompute the internal format each time."
  }],
  ["buffer", {
    name: "buffer",
    parameters: [
      { name: "initialData", type: "string", optional: true }
    ],
    returnType: "struct.buffer",
    description: "Creates a new struct buffer instance for incremental packing and unpacking of binary data. If initial data is provided, the buffer is initialized with this content."
  }]
]);

export class StructTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(structFunctions.keys());
  }

  getFunction(name: string): StructFunctionSignature | undefined {
    return structFunctions.get(name);
  }

  isStructFunction(name: string): boolean {
    return structFunctions.has(name);
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

    // Add format string examples for pack/unpack functions
    if (name === 'pack') {
      doc += `**Examples:**\n\`\`\`ucode\n// Pack three integers as network byte order\nlet data = pack('!III', 1, 2, 3);\n\n// Pack string and integer\nlet buffer = pack('10sI', 'hello', 12345);\n\`\`\`\n\n`;
      doc += `**Format Characters:**\n- \`b\` - signed char (-128 to 127)\n- \`B\` - unsigned char (0 to 255)\n- \`h\` - short (2 bytes)\n- \`H\` - unsigned short (2 bytes)\n- \`i\` - int (4 bytes)\n- \`I\` - unsigned int (4 bytes)\n- \`l\` - long (4 bytes)\n- \`L\` - unsigned long (4 bytes)\n- \`q\` - long long (8 bytes)\n- \`Q\` - unsigned long long (8 bytes)\n- \`f\` - float (4 bytes)\n- \`d\` - double (8 bytes)\n- \`s\` - string\n- \`p\` - Pascal string\n- \`?\` - bool\n\n**Byte Order:**\n- \`@\` - native (default)\n- \`<\` - little-endian\n- \`>\` - big-endian\n- \`!\` - network (big-endian)`;
    } else if (name === 'unpack') {
      doc += `**Examples:**\n\`\`\`ucode\n// Unpack three integers from network byte order\nlet values = unpack('!III', data);\nprint(values); // [1, 2, 3]\n\n// Unpack with offset\nlet result = unpack('I', buffer, 4);\n\`\`\``;
    } else if (name === 'new') {
      doc += `**Examples:**\n\`\`\`ucode\n// Create reusable format\nlet fmt = struct.new('!III');\nlet data = fmt.pack(1, 2, 3);\nlet values = fmt.unpack(data);\n\`\`\``;
    } else if (name === 'buffer') {
      doc += `**Examples:**\n\`\`\`ucode\n// Create empty buffer\nlet buf = struct.buffer();\nbuf.put('I', 1234);\nlet value = buf.get('I');\n\n// Create buffer with initial data\nlet buf2 = struct.buffer("\\x01\\x02\\x03\\x04");\nlet num = buf2.get('I');\n\`\`\``;
    }
    
    return doc;
  }

  // Import validation methods
  isValidImport(name: string): boolean {
    return this.isStructFunction(name);
  }

  getValidImports(): string[] {
    return this.getFunctionNames();
  }
}

export const structTypeRegistry = new StructTypeRegistry();