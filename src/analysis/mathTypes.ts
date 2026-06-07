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
  }],
  ["deg2rad", {
    name: "deg2rad",
    parameters: [
      { name: "degrees", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Converts the given value from degrees to radians. e.g. deg2rad(180) returns 3.1415926535898. Returns NaN if the argument cannot be converted to a number."
  }],
  ["rad2deg", {
    name: "rad2deg",
    parameters: [
      { name: "radians", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Converts the given value from radians to degrees. e.g. rad2deg(3.1415926535898) returns 180.0. Returns NaN if the argument cannot be converted to a number."
  }],
  // --- Trigonometric / hyperbolic (added upstream in the ext_maths set) ---
  ["acos", {
    name: "acos",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the arc cosine (inverse cosine) of x, returning the result in radians. Returns NaN if x cannot be converted to a number or lies outside [-1, 1]."
  }],
  ["asin", {
    name: "asin",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the arc sine (inverse sine) of x, returning the result in radians. Returns NaN if x cannot be converted to a number or lies outside [-1, 1]."
  }],
  ["atan", {
    name: "atan",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the arc tangent (inverse tangent) of x, returning the result in radians (range [-π/2, π/2]). Returns NaN if x cannot be converted to a number."
  }],
  ["tan", {
    name: "tan",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the tangent of x, where x is given in radians. Returns NaN if x cannot be converted to a number."
  }],
  ["cosh", {
    name: "cosh",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the hyperbolic cosine of x. Returns NaN if x cannot be converted to a number."
  }],
  ["sinh", {
    name: "sinh",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the hyperbolic sine of x. Returns NaN if x cannot be converted to a number."
  }],
  ["tanh", {
    name: "tanh",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the hyperbolic tangent of x. Returns NaN if x cannot be converted to a number."
  }],
  // --- Exponential / logarithmic ---
  ["expm1", {
    name: "expm1",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates e raised to the power of x, minus 1 (e^x - 1), accurately even when x is close to zero. Returns NaN if x cannot be converted to a number."
  }],
  ["log1p", {
    name: "log1p",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the natural logarithm of (1 + x), accurately even when x is close to zero. Returns NaN if x cannot be converted to a number, or if x < -1."
  }],
  ["log10", {
    name: "log10",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the base-10 logarithm of x. Returns NaN if x cannot be converted to a number, or if x is negative."
  }],
  ["log2", {
    name: "log2",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the base-2 logarithm of x. Returns NaN if x cannot be converted to a number, or if x is negative."
  }],
  // --- Roots / magnitudes ---
  ["cbrt", {
    name: "cbrt",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "double",
    description: "Calculates the cube root of x. Returns NaN if x cannot be converted to a number."
  }],
  ["hypot", {
    name: "hypot",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "y", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Returns sqrt(x² + y²) without undue overflow or underflow. Returns NaN if either argument cannot be converted to a number."
  }],
  ["copysign", {
    name: "copysign",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "y", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Returns a value with the magnitude of x and the sign of y. Returns NaN if either argument cannot be converted to a number."
  }],
  // --- Min / max / clamp ---
  ["fmin", {
    name: "fmin",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "y", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Returns the lesser of the two values x and y. Returns NaN if either argument cannot be converted to a number."
  }],
  ["fmax", {
    name: "fmax",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "y", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Returns the greater of the two values x and y. Returns NaN if either argument cannot be converted to a number."
  }],
  ["clamp", {
    name: "clamp",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "upper", type: "number", optional: false },
      { name: "lower", type: "number", optional: false }
    ],
    returnType: "double",
    description: "Clamps x to within the lower and upper bounds — effectively min(upper, max(x, lower)). Returns NaN if any argument cannot be converted to a number."
  }],
  // --- Sign / classification ---
  ["sign", {
    name: "sign",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "integer",
    description: "Returns -1 or 1 for negative and positive inputs respectively, 0 if x is zero, or NaN if x cannot be converted to a number."
  }],
  ["signbit", {
    name: "signbit",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "integer",
    description: "Like sign(), but with IEEE-754 behaviour: returns -1 for negative inputs (including -0.0), 1 for positive inputs, 0 for +0.0, or NaN if x cannot be converted to a number."
  }],
  ["signnz", {
    name: "signnz",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "integer",
    description: "Returns -1 or 1 depending on the sign of x only (no zero): zero is treated as +1. Returns NaN if x cannot be converted to a number."
  }],
  ["isinf", {
    name: "isinf",
    parameters: [{ name: "x", type: "number", optional: false }],
    returnType: "boolean",
    description: "Returns true if x is double-precision Infinity (values ≥ 1.8e308 are considered Infinity), otherwise false."
  }],
  // --- Rounding (output_type: false → integer, true → double) ---
  ["floor", {
    name: "floor",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "output_type", type: "boolean", optional: true }
    ],
    returnType: "number",
    description: "Returns the largest integer value not greater than x. With output_type false (default) the result is an integer, with true it is a double. Returns NaN if x cannot be converted to a number."
  }],
  ["ceil", {
    name: "ceil",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "output_type", type: "boolean", optional: true }
    ],
    returnType: "number",
    description: "Returns the smallest integer value not less than x. With output_type false (default) the result is an integer, with true it is a double. Returns NaN if x cannot be converted to a number."
  }],
  ["round", {
    name: "round",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "output_type", type: "boolean", optional: true }
    ],
    returnType: "number",
    description: "Returns the integral value nearest to x, rounding half-way cases away from zero. With output_type false (default) the result is an integer, with true it is a double. Returns NaN if x cannot be converted to a number."
  }],
  ["trunc", {
    name: "trunc",
    parameters: [
      { name: "x", type: "number", optional: false },
      { name: "output_type", type: "boolean", optional: true }
    ],
    returnType: "number",
    description: "Returns the integral value nearest to but no greater in magnitude than x (truncation toward zero). With output_type false (default) the result is an integer, with true it is a double. Returns NaN if x cannot be converted to a number."
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
