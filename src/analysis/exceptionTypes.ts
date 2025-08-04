/**
 * Exception object type definitions and property signatures
 * Based on ucode exception objects in catch blocks
 */

export interface ExceptionPropertySignature {
  name: string;
  type: string;
  description: string;
}

export const exceptionProperties: Map<string, ExceptionPropertySignature> = new Map([
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

export class ExceptionTypeRegistry {
  getPropertyNames(): string[] {
    return Array.from(exceptionProperties.keys());
  }

  getProperty(name: string): ExceptionPropertySignature | undefined {
    return exceptionProperties.get(name);
  }

  isExceptionProperty(name: string): boolean {
    return exceptionProperties.has(name);
  }

  formatPropertySignature(name: string): string {
    const prop = this.getProperty(name);
    if (!prop) return '';
    
    return `${name}: ${prop.type}`;
  }

  getPropertyDocumentation(name: string): string {
    const prop = this.getProperty(name);
    if (!prop) return '';
    
    let doc = `**(exception property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`;
    
    // Add detailed structure information for stacktrace
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
  }

  getAllPropertiesDocumentation(): string {
    return `## Exception Object

Exception objects are available in \`catch\` blocks and contain information about errors that occurred.

### Available Properties

${this.getPropertyNames().map(name => {
  const prop = this.getProperty(name);
  return `- **\`${name}\`** (\`${prop?.type}\`) - ${prop?.description}`;
}).join('\n')}

### Usage
\`\`\`ucode
try {
    riskyOperation();
} catch (e) {
    print("Error: " + e.message);
    print("Type: " + e.type);
    print("Stack: " + e.stacktrace);
}
\`\`\``;
  }
}

export const exceptionTypeRegistry = new ExceptionTypeRegistry();

// Import UcodeDataType and UcodeType for createExceptionObjectDataType
import { UcodeDataType, UcodeType } from './symbolTable';

/**
 * Create a UcodeDataType for exception objects
 */
export function createExceptionObjectDataType(): UcodeDataType {
  return {
    type: UcodeType.OBJECT,
    moduleName: 'exception'
  };
}