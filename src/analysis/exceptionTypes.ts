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
    type: "string",
    description: "Stack trace showing the call stack when the error occurred"
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
    
    return `**(exception property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`;
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