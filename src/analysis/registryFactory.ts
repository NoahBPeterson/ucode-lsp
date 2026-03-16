/**
 * Generic factory functions for creating module and object type registries.
 *
 * Eliminates per-module registry classes. Each module just defines its data
 * as a ModuleDefinition, and this factory creates the uniform ModuleRegistry
 * and ObjectTypeRegistry interfaces consumed by moduleDispatch.ts.
 */
import { Option } from 'effect';
import type { FunctionSignature, ModuleRegistry, ObjectTypeRegistry, KnownModule, KnownObjectType } from './moduleTypes';

// ---- Module definition types ----

export interface ConstantDefinition {
  readonly name: string;
  readonly value: string | number;
  readonly type: string;
  readonly description: string;
}

export interface PropertyDefinition {
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

export interface ModuleDefinition {
  readonly name: string;
  readonly functions: ReadonlyMap<string, FunctionSignature>;
  readonly constants?: ReadonlyMap<string, ConstantDefinition>;
  readonly constantDocumentation?: ReadonlyMap<string, string>;
  readonly documentation: string;
  readonly importValidation?: {
    isValid: (name: string) => boolean;
    getValidImports: () => string[];
  };
}

export interface ObjectTypeDefinition {
  readonly typeName: string;
  readonly isPropertyBased?: boolean;
  readonly methods: ReadonlyMap<string, FunctionSignature>;
  readonly properties?: ReadonlyMap<string, PropertyDefinition>;
  readonly formatDoc?: (name: string, sig: FunctionSignature) => string;
  readonly formatPropertyDoc?: (name: string, prop: PropertyDefinition) => string;
}

// ---- Shared formatting ----

export function formatFunctionSignature(_moduleName: string, sig: FunctionSignature): string {
  const params = sig.parameters.map(p => {
    if (p.optional && p.defaultValue !== undefined) {
      return `[${p.name}: ${p.type}] = ${p.defaultValue}`;
    } else if (p.optional) {
      return `[${p.name}: ${p.type}]`;
    }
    return `${p.name}: ${p.type}`;
  }).join(', ');

  return `${sig.name}(${params}): ${sig.returnType}`;
}

export function formatFunctionDoc(moduleName: string, sig: FunctionSignature): string {
  const signature = formatFunctionSignature(moduleName, sig);
  let doc = `**${signature}**\n\n${sig.description}\n\n`;

  if (sig.parameters.length > 0) {
    doc += '**Parameters:**\n';
    sig.parameters.forEach(param => {
      const optional = param.optional ? ' (optional)' : '';
      const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
      doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\n`;
    });
    doc += '\n';
  }

  doc += `**Returns:** \`${sig.returnType}\``;
  return doc;
}

function formatMethodDoc(typeName: string, sig: FunctionSignature): string {
  const params = sig.parameters.map(p => {
    const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
    return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
  }).join(', ');

  const prefix = typeName.includes('.') ? typeName.split('.')[1] : typeName;
  return `**${prefix}.${sig.name}(${params}): ${sig.returnType}**\n\n${sig.description}`;
}

function formatPropertyDoc(typeName: string, prop: PropertyDefinition): string {
  return `**(${typeName} property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`;
}

// ---- Factory functions ----

export function createModuleRegistry(def: ModuleDefinition): ModuleRegistry {
  const functionNames = Array.from(def.functions.keys());
  const constantNames = def.constants ? Array.from(def.constants.keys()) : [];
  const allImports = [...functionNames, ...constantNames];

  return {
    moduleName: def.name as KnownModule,
    getFunctionNames: () => functionNames,
    getFunction: (name: string) => Option.fromNullable(def.functions.get(name)),
    getFunctionDocumentation: (name: string) => {
      const sig = def.functions.get(name);
      if (!sig) return Option.none();
      return Option.some(formatFunctionDoc(def.name, sig));
    },
    getConstantNames: () => constantNames,
    getConstantDocumentation: (name: string) => {
      if (def.constantDocumentation) {
        const doc = def.constantDocumentation.get(name);
        if (doc) return Option.some(doc);
      }
      if (def.constants) {
        const c = def.constants.get(name);
        if (c) return Option.some(`**(constant) ${c.name}** = ${c.value}\n\n${c.description}`);
      }
      return Option.none();
    },
    isValidImport: def.importValidation?.isValid ?? ((name: string) => allImports.includes(name)),
    getValidImports: def.importValidation?.getValidImports ?? (() => allImports),
    getModuleDocumentation: () => def.documentation,
  };
}

export function createObjectTypeRegistry(def: ObjectTypeDefinition): ObjectTypeRegistry {
  // Property-based types use the properties map
  if (def.isPropertyBased && def.properties) {
    const propertyNames = Array.from(def.properties.keys());
    return {
      objectType: def.typeName as KnownObjectType,
      isPropertyBased: true,
      getMethodNames: () => propertyNames,
      getMethod: (name: string) => {
        const prop = def.properties!.get(name);
        if (!prop) return Option.none();
        return Option.some({
          name: prop.name,
          parameters: [],
          returnType: prop.type,
          description: prop.description,
        });
      },
      getMethodDocumentation: (name: string) => {
        const prop = def.properties!.get(name);
        if (!prop) return Option.none();
        const doc = def.formatPropertyDoc
          ? def.formatPropertyDoc(name, prop)
          : formatPropertyDoc(def.typeName, prop);
        return Option.some(doc);
      },
    };
  }

  // Method-based types use the methods map
  const methodNames = Array.from(def.methods.keys());
  return {
    objectType: def.typeName as KnownObjectType,
    ...(def.isPropertyBased !== undefined ? { isPropertyBased: def.isPropertyBased } : {}),
    getMethodNames: () => methodNames,
    getMethod: (name: string) => Option.fromNullable(def.methods.get(name)),
    getMethodDocumentation: (name: string) => {
      const sig = def.methods.get(name);
      if (!sig) return Option.none();
      const doc = def.formatDoc
        ? def.formatDoc(name, sig)
        : formatMethodDoc(def.typeName, sig);
      return Option.some(doc);
    },
  };
}
