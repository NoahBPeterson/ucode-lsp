/**
 * Math module type definitions and function signatures
 * Based on ucode/lib/math.c
 */

export interface MathFunctionSignature {
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

export const mathFunctions: Map<string, MathFunctionSignature> = new Map([
  ["abs", {
    name: "abs",
    parameters: [
      { name: "number", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Returns the absolute value of the given numeric value. Returns NaN if the argument cannot be converted to a number."
  }],
  ["atan2", {
    name: "atan2",
    parameters: [
      { name: "y", type: "number", optional: false },
      { name: "x", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the principal value of the arc tangent of y/x, using the signs of the two arguments to determine the quadrant of the result. Returns the result in radians (range [-π, π])."
  }],
  ["cos", {
    name: "cos",
    parameters: [
      { name: "x", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the cosine of x, where x is given in radians. Returns NaN if x cannot be converted to a number."
  }],
  ["exp", {
    name: "exp",
    parameters: [
      { name: "x", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the value of e (the base of natural logarithms) raised to the power of x. Returns NaN if x cannot be converted to a number."
  }],
  ["log", {
    name: "log",
    parameters: [
      { name: "x", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the natural logarithm of x. Returns NaN if x cannot be converted to a number, or if x is negative."
  }],
  ["sin", {
    name: "sin",
    parameters: [
      { name: "x", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the sine of x, where x is given in radians. Returns NaN if x cannot be converted to a number."
  }],
  ["sqrt", {
    name: "sqrt",
    parameters: [
      { name: "x", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the nonnegative square root of x. Returns NaN if x cannot be converted to a number or if x is negative."
  }],
  ["pow", {
    name: "pow",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "y", type: "number", optional: false }
    ],
    returnType: "number",
    description: "Calculates the value of x raised to the power of y. Returns NaN if either x or y cannot be converted to a number."
  }],
  ["rand", {
    name: "rand",
    parameters: [],
    returnType: "number",
    description: "Produces a pseudo-random positive integer in the range 0 to RAND_MAX inclusive (at least 32767). Automatically seeds the PRNG on first use if not manually seeded."
  }],
  ["srand", {
    name: "srand",
    parameters: [
      { name: "seed", type: "number", optional: false }
    ],
    returnType: "null",
    description: "Seeds the pseudo-random number generator with the given value. This affects the sequence produced by subsequent calls to rand()."
  }],
  ["isnan", {
    name: "isnan",
    parameters: [
      { name: "x", type: "number", optional: false }
    ],
    returnType: "boolean",
    description: "Tests whether x is a NaN (not a number) double value. Returns true if the value is NaN, otherwise false."
  }]
]);

export class MathTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(mathFunctions.keys());
  }

  getFunction(name: string): MathFunctionSignature | undefined {
    return mathFunctions.get(name);
  }

  isMathFunction(name: string): boolean {
    return mathFunctions.has(name);
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
    return doc;
  }

  // Import validation methods
  isValidMathImport(name: string): boolean {
    return this.isMathFunction(name);
  }

  getValidMathImports(): string[] {
    return this.getFunctionNames();
  }
}

export const mathTypeRegistry = new MathTypeRegistry();