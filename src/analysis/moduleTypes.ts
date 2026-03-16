/**
 * Shared type definitions for the module registry system.
 *
 * These types are the canonical source — all module type files and
 * moduleDispatch.ts import from here instead of defining their own.
 */
import { Option } from 'effect';

// ---- Module/object type enumerations ----

export const KNOWN_MODULES = [
  'debug', 'digest', 'fs', 'io', 'log', 'math',
  'nl80211', 'resolv', 'rtnl', 'socket', 'struct',
  'ubus', 'uci', 'uloop', 'zlib'
] as const;

export type KnownModule = typeof KNOWN_MODULES[number];

export type KnownObjectType =
  | 'fs.file' | 'fs.dir' | 'fs.proc' | 'fs.statvfs'
  | 'io.handle'
  | 'uloop.timer' | 'uloop.handle' | 'uloop.process'
  | 'uloop.task' | 'uloop.interval' | 'uloop.signal' | 'uloop.pipe'
  | 'uci.cursor'
  | 'nl80211.listener'
  | 'exception';

// ---- Common function signature ----

export interface FunctionSignature {
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

// ---- Uniform adapter interfaces ----

export interface ModuleRegistry {
  readonly moduleName: KnownModule;
  getFunctionNames(): string[];
  getFunction(name: string): Option.Option<FunctionSignature>;
  getFunctionDocumentation(name: string): Option.Option<string>;
  getConstantNames(): string[];
  getConstantDocumentation(name: string): Option.Option<string>;
  isValidImport(name: string): boolean;
  getValidImports(): string[];
  getModuleDocumentation(): string;
}

export interface ObjectTypeRegistry {
  readonly objectType: KnownObjectType;
  readonly isPropertyBased?: boolean;
  getMethodNames(): string[];
  getMethod(name: string): Option.Option<FunctionSignature>;
  getMethodDocumentation(name: string): Option.Option<string>;
}

export type LookupError =
  | { readonly _tag: 'ModuleNotFound'; readonly name: string }
  | { readonly _tag: 'MemberNotFound'; readonly module: string; readonly member: string };
