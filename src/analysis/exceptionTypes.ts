/**
 * Exception object type definitions and property signatures
 * Based on ucode exception objects in catch blocks
 */

import type { PropertyDefinition, ObjectTypeDefinition } from './registryFactory';

// Import UcodeDataType and UcodeType for createExceptionObjectDataType
import { UcodeDataType, UcodeType } from './symbolTable';

const properties = new Map<string, PropertyDefinition>([
  ["message", {
    name: "message",
    type: "string",
    description: "Error message describing what went wrong"
  }],
  ["stacktrace", {
    name: "stacktrace",
    type: "array",
    description: "Array of stack frame objects with filename, line, byte, function (optional), and context (optional) properties"
  }],
  ["type", {
    name: "type",
    type: "string",
    description: "Type of the exception (e.g., 'TypeError', 'ReferenceError', etc.)"
  }]
]);

export const exceptionObjectType: ObjectTypeDefinition = {
  typeName: 'exception',
  isPropertyBased: true,
  methods: new Map(),
  properties,
  formatPropertyDoc: (name: string, prop: PropertyDefinition) => {
    let doc = `**(exception property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`;

    if (name === 'stacktrace') {
      doc += `\n\n**Stack Frame Structure:**\n`;
      doc += `- \`filename\` (string) - Source file path\n`;
      doc += `- \`line\` (number) - Line number in the file\n`;
      doc += `- \`byte\` (number) - Byte offset in the file\n`;
      doc += `- \`function\` (string, optional) - Function name if available\n`;
      doc += `- \`context\` (string, optional) - Additional context information\n\n`;
      doc += `**Example:**\n`;
      doc += `\`\`\`ucode\n`;
      doc += `try {\n`;
      doc += `  riskyOperation();\n`;
      doc += `} catch (e) {\n`;
      doc += `  for (let frame in e.stacktrace) {\n`;
      doc += `    print("File: " + frame.filename + ", Line: " + frame.line);\n`;
      doc += `  }\n`;
      doc += `}\n`;
      doc += `\`\`\``;
    }

    return doc;
  },
};

// Backwards compatibility
export const exceptionTypeRegistry = {
  getPropertyNames: () => Array.from(properties.keys()),
  getProperty: (name: string) => properties.get(name),
  isExceptionProperty: (name: string) => properties.has(name),
  getPropertyDocumentation: (name: string) => {
    const prop = properties.get(name);
    if (!prop) return '';
    return `**(exception property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`;
  },
};

/**
 * Create a UcodeDataType for exception objects
 */
export function createExceptionObjectDataType(): UcodeDataType {
  return UcodeType.OBJECT;
}
