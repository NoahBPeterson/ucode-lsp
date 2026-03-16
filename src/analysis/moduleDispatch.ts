/**
 * Central module dispatch layer
 *
 * Single source of truth for module dispatch. Wraps existing module registries
 * with a uniform interface and provides exhaustive dispatch via Effect.js.
 *
 * Types are defined in moduleTypes.ts. Factory functions are in registryFactory.ts.
 * Module data is defined in each *Types.ts file as a ModuleDefinition/ObjectTypeDefinition.
 */
import { Option, Either } from 'effect';

// Re-export canonical types from moduleTypes.ts
export {
  KNOWN_MODULES,
  type KnownModule,
  type KnownObjectType,
  type FunctionSignature,
  type ModuleRegistry,
  type ObjectTypeRegistry,
  type LookupError,
} from './moduleTypes';

import type { KnownModule, KnownObjectType, FunctionSignature, ModuleRegistry, ObjectTypeRegistry } from './moduleTypes';
import { KNOWN_MODULES } from './moduleTypes';
import { createModuleRegistry, createObjectTypeRegistry } from './registryFactory';

// ---- Module definitions ----
import { debugModule } from './debugTypes';
import { digestModule } from './digestTypes';
import { mathModule } from './mathTypes';
import { resolvModule } from './resolvTypes';
import { structModule } from './structTypes';
import { fsModule, statvfsObjectType } from './fsModuleTypes';
import { exceptionObjectType } from './exceptionTypes';
import { logModule } from './logTypes';
import { rtnlModule } from './rtnlTypes';
import { socketModule } from './socketTypes';
import { ubusModule } from './ubusTypes';
import { zlibModule } from './zlibTypes';
import { ioModule, ioHandleObjectType } from './ioTypes';
import { nl80211Module, nl80211ListenerObjectType } from './nl80211Types';
import { uciModule, uciCursorObjectType } from './uciTypes';
import { uloopModule, uloopTimerObjectType, uloopHandleObjectType, uloopProcessObjectType, uloopTaskObjectType, uloopIntervalObjectType, uloopSignalObjectType, uloopPipeObjectType } from './uloopTypes';
import { fsProcObjectType, fsDirObjectType, fsFileObjectType } from './fsTypes';

// ---- Build MODULE_REGISTRIES using factory ----

export const MODULE_REGISTRIES: Record<KnownModule, ModuleRegistry> = {
  debug: createModuleRegistry(debugModule),
  digest: createModuleRegistry(digestModule),
  fs: createModuleRegistry(fsModule),
  io: createModuleRegistry(ioModule),
  log: createModuleRegistry(logModule),
  math: createModuleRegistry(mathModule),
  nl80211: createModuleRegistry(nl80211Module),
  resolv: createModuleRegistry(resolvModule),
  rtnl: createModuleRegistry(rtnlModule),
  socket: createModuleRegistry(socketModule),
  struct: createModuleRegistry(structModule),
  ubus: createModuleRegistry(ubusModule),
  uci: createModuleRegistry(uciModule),
  uloop: createModuleRegistry(uloopModule),
  zlib: createModuleRegistry(zlibModule),
};

// ---- Build OBJECT_REGISTRIES using factory ----

export const OBJECT_REGISTRIES: Record<KnownObjectType, ObjectTypeRegistry> = {
  'fs.file': createObjectTypeRegistry(fsFileObjectType),
  'fs.dir': createObjectTypeRegistry(fsDirObjectType),
  'fs.proc': createObjectTypeRegistry(fsProcObjectType),
  'fs.statvfs': createObjectTypeRegistry(statvfsObjectType),
  'io.handle': createObjectTypeRegistry(ioHandleObjectType),
  'uloop.timer': createObjectTypeRegistry(uloopTimerObjectType),
  'uloop.handle': createObjectTypeRegistry(uloopHandleObjectType),
  'uloop.process': createObjectTypeRegistry(uloopProcessObjectType),
  'uloop.task': createObjectTypeRegistry(uloopTaskObjectType),
  'uloop.interval': createObjectTypeRegistry(uloopIntervalObjectType),
  'uloop.signal': createObjectTypeRegistry(uloopSignalObjectType),
  'uloop.pipe': createObjectTypeRegistry(uloopPipeObjectType),
  'uci.cursor': createObjectTypeRegistry(uciCursorObjectType),
  'nl80211.listener': createObjectTypeRegistry(nl80211ListenerObjectType),
  'exception': createObjectTypeRegistry(exceptionObjectType),
};

// Derived from OBJECT_REGISTRIES — no separate list to maintain
export const KNOWN_OBJECT_TYPES: readonly KnownObjectType[] = Object.keys(OBJECT_REGISTRIES) as KnownObjectType[];

// ---- Utility functions ----

export function isKnownModule(name: string): name is KnownModule {
  return name in MODULE_REGISTRIES;
}

export function isKnownObjectType(name: string): name is KnownObjectType {
  return name in OBJECT_REGISTRIES;
}

export function getModuleRegistry(name: string): Option.Option<ModuleRegistry> {
  if (isKnownModule(name)) {
    return Option.some(MODULE_REGISTRIES[name]);
  }
  return Option.none();
}

export function getObjectTypeRegistry(name: string): Option.Option<ObjectTypeRegistry> {
  if (isKnownObjectType(name)) {
    return Option.some(OBJECT_REGISTRIES[name]);
  }
  return Option.none();
}

/**
 * Extract an object type from a return type string like "uci.cursor | null" → "uci.cursor"
 */
function extractObjectTypeFromReturnType(returnType: string): KnownObjectType | null {
  const trimmed = returnType.trim();
  if (isKnownObjectType(trimmed)) return trimmed;

  for (const part of trimmed.split('|')) {
    const candidate = part.trim();
    if (candidate && isKnownObjectType(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the return object type for a function call.
 * Given a function name (and optional module name), look up its FunctionSignature
 * and extract the object type from its returnType.
 */
export function resolveReturnObjectType(funcName: string, moduleName?: string): KnownObjectType | null {
  if (moduleName && isKnownModule(moduleName)) {
    const reg = MODULE_REGISTRIES[moduleName];
    const sig = reg.getFunction(funcName);
    if (Option.isSome(sig)) {
      return extractObjectTypeFromReturnType(sig.value.returnType);
    }
    return null;
  }

  // No module specified — search all modules (handles bare named imports like cursor())
  for (const mod of KNOWN_MODULES) {
    const reg = MODULE_REGISTRIES[mod];
    const sig = reg.getFunction(funcName);
    if (Option.isSome(sig)) {
      const objType = extractObjectTypeFromReturnType(sig.value.returnType);
      if (objType) return objType;
    }
  }
  return null;
}

// ---- Dispatch functions ----

/**
 * Get documentation for a module member (function or constant).
 */
export function getModuleMemberDocumentation(m: KnownModule, member: string): Option.Option<string> {
  const reg = MODULE_REGISTRIES[m];
  const funcDoc = reg.getFunctionDocumentation(member);
  if (Option.isSome(funcDoc)) return funcDoc;
  return reg.getConstantDocumentation(member);
}

/**
 * Get documentation for an imported symbol.
 */
export function getImportedSymbolDocumentation(m: KnownModule, name: string): Option.Option<string> {
  const reg = MODULE_REGISTRIES[m];
  const funcDoc = reg.getFunctionDocumentation(name);
  if (Option.isSome(funcDoc)) return funcDoc;
  const constDoc = reg.getConstantDocumentation(name);
  if (Option.isSome(constDoc)) return constDoc;
  return Option.some(reg.getModuleDocumentation());
}

/**
 * Validate an import from a known module.
 * Returns Either.right(true) if valid, Either.left with error message if invalid.
 */
export function validateImport(m: KnownModule, name: string): Either.Either<true, string> {
  const reg = MODULE_REGISTRIES[m];
  if (reg.isValidImport(name)) {
    return Either.right(true);
  }
  return Either.left(
    `'${name}' is not exported by the ${m} module. Available exports: ${reg.getValidImports().join(', ')}`
  );
}

/**
 * Resolve a method on a known object type.
 */
export function resolveObjectMethod(t: KnownObjectType, method: string): Option.Option<FunctionSignature> {
  return OBJECT_REGISTRIES[t].getMethod(method);
}

/**
 * Get method documentation on a known object type.
 */
export function getObjectMethodDocumentation(t: KnownObjectType, method: string): Option.Option<string> {
  return OBJECT_REGISTRIES[t].getMethodDocumentation(method);
}

/**
 * Get all method names for a known object type.
 */
export function getObjectMethodNames(t: KnownObjectType): string[] {
  return OBJECT_REGISTRIES[t].getMethodNames();
}
