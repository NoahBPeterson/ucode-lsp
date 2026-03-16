/**
 * Math module type definitions and function signatures
 * Based on ucode/lib/math.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
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
    parameters: [
      { name: "a", type: "number", optional: true },
      { name: "b", type: "number", optional: true }
    ],
    returnType: "number",
    description: "Without arguments, returns a pseudo-random integer 0..RAND_MAX. With one argument a, returns a random double 0..a. With two arguments a,b, returns a random double a..b."
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

export const mathModule: ModuleDefinition = {
  name: 'math',
  functions,
  documentation: `## Math Module

**Mathematical and trigonometric functions for ucode scripts**

The math module provides comprehensive mathematical operations including basic arithmetic, trigonometry, logarithms, and random number generation.

### Usage

**Named import syntax:**
\`\`\`ucode
import { sin, cos, pow, sqrt, abs } from 'math';

let angle = 3.14159 / 4;  // 45 degrees in radians
let x = cos(angle);       // ~0.707
let y = sin(angle);       // ~0.707
let hypotenuse = sqrt(pow(x, 2) + pow(y, 2));  // ~1.0
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as math from 'math';

let angle = 3.14159 / 4;  // 45 degrees in radians
let x = math.cos(angle);  // ~0.707
let y = math.sin(angle);  // ~0.707
let hypotenuse = math.sqrt(math.pow(x, 2) + math.pow(y, 2));  // ~1.0
\`\`\`

### Available Functions

**Basic operations:**
- **\`abs()\`** - Absolute value
- **\`pow()\`** - Exponentiation (x^y)
- **\`sqrt()\`** - Square root

**Trigonometric functions:**
- **\`sin()\`** - Sine (radians)
- **\`cos()\`** - Cosine (radians)
- **\`atan2()\`** - Arc tangent of y/x (radians)

**Logarithmic and exponential:**
- **\`log()\`** - Natural logarithm
- **\`exp()\`** - e raised to the power of x

**Random number generation:**
- **\`rand()\`** - Generate pseudo-random integer
- **\`srand()\`** - Seed the random number generator

**Utility functions:**
- **\`isnan()\`** - Test if value is NaN (not a number)

### Notes

- All trigonometric functions use radians, not degrees
- Functions return NaN for invalid inputs
- \`rand()\` returns integers in range [0, RAND_MAX] (at least 32767)
- \`srand()\` can be used to create reproducible random sequences

*Hover over individual function names for detailed parameter and return type information.*`,
};

// Backwards compatibility
export const mathTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isMathFunction: (name: string) => functions.has(name),
  isValidMathImport: (name: string) => functions.has(name),
  getValidMathImports: () => Array.from(functions.keys()),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('math', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('math', func);
  },
};
