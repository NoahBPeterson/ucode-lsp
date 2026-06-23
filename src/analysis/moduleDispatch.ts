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

import type { KnownModule, KnownObjectType, ModuleRegistry, ObjectTypeRegistry } from './moduleTypes';
import { KNOWN_MODULES } from './moduleTypes';
import { createModuleRegistry, createObjectTypeRegistry } from './registryFactory';

// ---- Module definitions ----
import { debugModule } from './debugTypes';
import { digestModule } from './digestTypes';
import { mathModule } from './mathTypes';
import { resolvModule } from './resolvTypes';
import { structModule, structInstanceObjectType, structBufferObjectType } from './structTypes';
import { fsModule, statvfsObjectType, statObjectType, statDevObjectType, statPermObjectType } from './fsModuleTypes';
import { exceptionObjectType } from './exceptionTypes';
import { logModule } from './logTypes';
import { rtnlModule, rtnlListenerObjectType } from './rtnlTypes';
import { socketModule, socketObjectType } from './socketTypes';
import { ubusModule, ubusConnectionObjectType, ubusChannelObjectType, ubusDeferredObjectType, ubusObjectObjectType, ubusRequestObjectType, ubusNotifyObjectType, ubusListenerObjectType, ubusSubscriberObjectType } from './ubusTypes';
import { zlibModule, zlibDeflateObjectType, zlibInflateObjectType } from './zlibTypes';
import { ioModule, ioHandleObjectType } from './ioTypes';
import { nl80211Module, nl80211ListenerObjectType } from './nl80211Types';
import { uciModule, uciCursorObjectType } from './uciTypes';
import { uloopModule, uloopTimerObjectType, uloopHandleObjectType, uloopProcessObjectType, uloopTaskObjectType, uloopIntervalObjectType, uloopSignalObjectType, uloopPipeObjectType } from './uloopTypes';
import { fsProcObjectType, fsDirObjectType, fsFileObjectType } from './fsTypes';
import { htmlModule } from './htmlTypes';
import { luaModule } from './luaTypes';
import { bpfModule, bpfModuleObjectType, bpfMapObjectType, bpfProgramObjectType, bpfMapIteratorObjectType } from './bpfTypes';
import { uclientModule } from './uclientTypes';
import { udebugModule } from './udebugTypes';

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
  bpf: createModuleRegistry(bpfModule),
  html: createModuleRegistry(htmlModule),
  lua: createModuleRegistry(luaModule),
  uclient: createModuleRegistry(uclientModule),
  udebug: createModuleRegistry(udebugModule),
};

// ---- Build OBJECT_REGISTRIES using factory ----

export const OBJECT_REGISTRIES: Record<KnownObjectType, ObjectTypeRegistry> = {
  'fs.file': createObjectTypeRegistry(fsFileObjectType),
  'fs.dir': createObjectTypeRegistry(fsDirObjectType),
  'fs.proc': createObjectTypeRegistry(fsProcObjectType),
  'fs.statvfs': createObjectTypeRegistry(statvfsObjectType),
  'fs.stat': createObjectTypeRegistry(statObjectType),
  'fs.stat.dev': createObjectTypeRegistry(statDevObjectType),
  'fs.stat.perm': createObjectTypeRegistry(statPermObjectType),
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
  'ubus.connection': createObjectTypeRegistry(ubusConnectionObjectType),
  'ubus.channel': createObjectTypeRegistry(ubusChannelObjectType),
  'ubus.deferred': createObjectTypeRegistry(ubusDeferredObjectType),
  'ubus.object': createObjectTypeRegistry(ubusObjectObjectType),
  'ubus.request': createObjectTypeRegistry(ubusRequestObjectType),
  'ubus.notify': createObjectTypeRegistry(ubusNotifyObjectType),
  'ubus.listener': createObjectTypeRegistry(ubusListenerObjectType),
  'ubus.subscriber': createObjectTypeRegistry(ubusSubscriberObjectType),
  'rtnl.listener': createObjectTypeRegistry(rtnlListenerObjectType),
  'socket': createObjectTypeRegistry(socketObjectType),
  'struct.instance': createObjectTypeRegistry(structInstanceObjectType),
  'struct.buffer': createObjectTypeRegistry(structBufferObjectType),
  'zlib.deflate': createObjectTypeRegistry(zlibDeflateObjectType),
  'zlib.inflate': createObjectTypeRegistry(zlibInflateObjectType),
  'bpf.module': createObjectTypeRegistry(bpfModuleObjectType),
  'bpf.map': createObjectTypeRegistry(bpfMapObjectType),
  'bpf.program': createObjectTypeRegistry(bpfProgramObjectType),
  'bpf.map.iterator': createObjectTypeRegistry(bpfMapIteratorObjectType),
  'exception': createObjectTypeRegistry(exceptionObjectType),
};

// ---- Utility functions ----

export function isKnownModule(name: string): name is KnownModule {
  return name in MODULE_REGISTRIES;
}

export function isKnownObjectType(name: string): name is KnownObjectType {
  return name in OBJECT_REGISTRIES;
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
  const constDoc = reg.getConstantDocumentation(member);
  if (Option.isSome(constDoc)) return constDoc;
  return reg.getObjectExportDocumentation(member);
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
  const exportDoc = reg.getObjectExportDocumentation(name);
  if (Option.isSome(exportDoc)) return exportDoc;
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
 * Get method documentation on a known object type.
 */
export function getObjectMethodDocumentation(t: KnownObjectType, method: string): Option.Option<string> {
  return OBJECT_REGISTRIES[t].getMethodDocumentation(method);
}
