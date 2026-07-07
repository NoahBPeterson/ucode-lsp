/**
 * Shared type definitions for the module registry system.
 *
 * These types are the canonical source — all module type files and
 * moduleDispatch.ts import from here instead of defining their own.
 */
import { Option } from 'effect';
import type { UcodeTargetVersion } from './ucodeVersions';

// ---- Module/object type enumerations ----

export const KNOWN_MODULES = [
  'debug', 'digest', 'fs', 'io', 'log', 'math',
  'nl80211', 'resolv', 'rtnl', 'socket', 'struct',
  'ubus', 'uci', 'uloop', 'zlib',
  // OpenWrt feed modules (ucode-mod-*), version-gated in ucodeVersions.ts:
  'bpf', 'html', 'lua',     // 23.05
  'uclient', 'udebug',      // 24.10
  'uline', 'pkgen',         // 25.12
  // LuCI library binding (liblucihttp-ucode); feed-available on all releases (22.03+),
  // pulled in by luci-base — not version-gated.
  'lucihttp'
] as const;

export type KnownModule = typeof KNOWN_MODULES[number];

export type KnownObjectType =
  | 'fs.file' | 'fs.dir' | 'fs.proc' | 'fs.statvfs'
  | 'fs.stat' | 'fs.stat.dev' | 'fs.stat.perm'
  | 'io.handle'
  | 'uloop.timer' | 'uloop.handle' | 'uloop.process'
  | 'uloop.task' | 'uloop.interval' | 'uloop.signal' | 'uloop.pipe'
  | 'uci.cursor' | 'uci.section'
  | 'nl80211.listener'
  | 'ubus.connection' | 'ubus.channel' | 'ubus.deferred' | 'ubus.object'
  | 'ubus.request' | 'ubus.notify' | 'ubus.listener' | 'ubus.subscriber'
  | 'rtnl.listener'
  | 'socket'
  | 'struct.instance' | 'struct.buffer'
  | 'zlib.deflate' | 'zlib.inflate'
  | 'bpf.module' | 'bpf.map' | 'bpf.program' | 'bpf.map.iterator'
  | 'uline.state' | 'uline.argp'
  | 'mbedtls.pk' | 'mbedtls.crt'
  | 'uhttpd'
  | 'netifd.proto'
  | 'netifd.daemon'
  | 'hostapd.global' | 'hostapd.bss' | 'hostapd.iface'
  | 'wpas.global' | 'wpas.iface'
  | 'exception';

// ---- Common function signature ----

export interface FunctionSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: string | number | boolean | null;
    /** Constant-name prefixes this parameter accepts (e.g. ['MSG_'] for a recv flags arg,
     *  ['AF_'] for a socket domain). Drives argument-position value completion: an empty/
     *  partial arg slot offers the module's constants matching any of these prefixes. */
    constantPrefixes?: string[];
    /** When this parameter is a callback (type: "function"), the inferred types of the
     *  callback's own parameters, positionally (e.g. uci `foreach`'s callback receives a
     *  single section object → ['object']). Drives callback param-type inference at call
     *  sites so the callback body can resolve member access / hover on its arguments. */
    callbackParamTypes?: string[];
    /** When true, this is a rest/variadic parameter absorbing all remaining arguments
     *  (e.g. fs.glob's `...patterns`). Surfaced in signature help as `...name`. */
    isRest?: boolean;
  }>;
  returnType: string;
  description: string;
  /** OpenWrt release this member first appeared in (per-member version floor). When set and the
   *  configured target is older, an access flags UC6005 — e.g. `hostapd.udebug_set` was added in
   *  24.10 even though the `hostapd` global itself exists from 23.05. Undefined ⇒ no per-member gate
   *  (the containing type's/ambient's floor applies). Verified against the OpenWrt release binaries. */
  introducedIn?: UcodeTargetVersion;
  /** When true, null in returnType means only "wrong argument type" — safe to narrow away
   *  when argument types are known to be correct. */
  nullMeansWrongType?: boolean;
}

// ---- Uniform adapter interfaces ----

export interface ModuleRegistry {
  readonly moduleName: KnownModule;
  getFunctionNames(): string[];
  getFunction(name: string): Option.Option<FunctionSignature>;
  getFunctionDocumentation(name: string): Option.Option<string>;
  getConstantNames(): string[];
  getConstantDocumentation(name: string): Option.Option<string>;
  /** Names of object-handle exports (e.g. fs `stdin`/`stdout`/`stderr`). */
  getObjectExportNames(): string[];
  /** The KnownObjectType string for an object-handle export (e.g. 'fs.file'), or null. */
  getObjectExportType(name: string): string | null;
  getObjectExportDocumentation(name: string): Option.Option<string>;
  isValidImport(name: string): boolean;
  getValidImports(): string[];
  getModuleDocumentation(): string;
}

export interface ObjectTypeRegistry {
  readonly objectType: KnownObjectType;
  readonly isPropertyBased?: boolean;
  /** When true, an access of a member NOT in the known set resolves to `unknown` instead of
   *  UC5004 — for objects the runtime extends dynamically (e.g. `netifd.ubus = …`). Known
   *  members still type/hover/complete; only the "does not exist" error is suppressed. */
  readonly openMembers?: boolean;
  getMethodNames(): string[];
  getMethod(name: string): Option.Option<FunctionSignature>;
  getMethodDocumentation(name: string): Option.Option<string>;
}

export type LookupError =
  | { readonly _tag: 'ModuleNotFound'; readonly name: string }
  | { readonly _tag: 'MemberNotFound'; readonly module: string; readonly member: string };
