import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { nl80211Functions, nl80211Constants } from './analysis/nl80211Types';
import { fsModuleFunctions } from './analysis/fsModuleTypes';
import { uloopConstants, uloopFunctions } from './analysis/uloopTypes';
import { uciFunctions } from './analysis/uciTypes';
import { ubusConstants, ubusFunctions } from './analysis/ubusTypes';
import { zlibConstants, zlibFunctions } from './analysis/zlibTypes';
import { structFunctions } from './analysis/structTypes';
import { socketConstants, socketFunctions } from './analysis/socketTypes';
import { rtnlConstants, rtnlFunctions } from './analysis/rtnlTypes';
import { debugFunctions } from './analysis/debugTypes';
import { logConstants, logFunctions } from './analysis/logTypes';
import { mathFunctions } from './analysis/mathTypes';
import { digestFunctions } from './analysis/digestTypes';
import { resolvFunctions } from './analysis/resolvTypes';

export interface ModuleMember {
    name: string;
    type: 'function' | 'resource' | 'constant' | 'unknown';
}

export interface DiscoveredModule {
    name: string;
    source: 'builtin' | 'system';
    path?: string;
    members?: ModuleMember[];
}

// Builtin modules that are always available
const BUILTIN_MODULES = [
    'fs', 'debug', 'log', 'math', 'ubus', 'uci', 'uloop', 
    'digest', 'nl80211', 'resolv', 'rtnl', 'socket', 'struct', 'zlib'
];

let cachedModules: DiscoveredModule[] | null = null;
let lastCacheTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Checks if the current platform supports ucode module discovery
 */
function isUnixLikePlatform(): boolean {
    const platform = os.platform();
    return platform === 'linux' || platform === 'darwin' || platform === 'freebsd' || platform === 'openbsd';
}

/**
 * Checks if ucode command is available
 */
function isUcodeAvailable(): boolean {
    try {
        execSync('command -v ucode', { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Gets module search paths from ucode runtime
 */
function getModuleSearchPaths(): string[] {
    try {
        const output = execSync(
            `ucode -e "print(join('\\n', filter(global.REQUIRE_SEARCH_PATH, function(element) {return match(element, /.*so/);}))); "`,
            { encoding: 'utf8', timeout: 5000 }
        );
        
        return output.trim().split('\n').filter(path => path.trim().length > 0);
    } catch (error) {
        console.warn('Failed to get ucode module search paths:', error);
        return [];
    }
}

/**
 * Discovers .so modules in the given search paths
 */
function discoverSoModules(searchPaths: string[]): DiscoveredModule[] {
    const modules: DiscoveredModule[] = [];
    
    for (const searchPath of searchPaths) {
        try {
            // Handle glob patterns like /usr/local/lib/ucode/*.so
            if (searchPath.includes('*')) {
                const dir = path.dirname(searchPath);
                const pattern = path.basename(searchPath);
                
                if (fs.existsSync(dir)) {
                    const files = fs.readdirSync(dir);
                    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                    
                    for (const file of files) {
                        if (regex.test(file) && file.endsWith('.so')) {
                            const moduleName = path.basename(file, '.so');
                            const fullPath = path.join(dir, file);
                            
                            // Skip if it's a builtin module (we'll add those separately)
                            if (!BUILTIN_MODULES.includes(moduleName)) {
                                modules.push({
                                    name: moduleName,
                                    source: 'system',
                                    path: fullPath
                                });
                            }
                        }
                    }
                }
            } else {
                // Handle direct paths
                if (fs.existsSync(searchPath) && searchPath.endsWith('.so')) {
                    const moduleName = path.basename(searchPath, '.so');
                    
                    if (!BUILTIN_MODULES.includes(moduleName)) {
                        modules.push({
                            name: moduleName,
                            source: 'system',
                            path: searchPath
                        });
                    }
                }
            }
        } catch (error) {
            // Silently skip paths that cause errors
            continue;
        }
    }
    
    return modules;
}

/**
 * Discovers all available ucode modules
 */
export function discoverAvailableModules(): DiscoveredModule[] {
    const now = Date.now();
    
    // Return cached result if still valid
    if (cachedModules && (now - lastCacheTime) < CACHE_DURATION) {
        return cachedModules;
    }
    
    const modules: DiscoveredModule[] = [];
    
    // Always include builtin modules
    for (const name of BUILTIN_MODULES) {
        modules.push({
            name,
            source: 'builtin'
        });
    }
    
    // Try to discover system modules on Unix-like platforms
    if (isUnixLikePlatform() && isUcodeAvailable()) {
        try {
            const searchPaths = getModuleSearchPaths();
            const systemModules = discoverSoModules(searchPaths);
            modules.push(...systemModules);
        } catch (error) {
            console.warn('Failed to discover system modules:', error);
        }
    }
    
    // Cache the result
    cachedModules = modules;
    lastCacheTime = now;
    
    return modules;
}

/**
 * Gets just the module names for completion
 */
export function getAvailableModuleNames(): string[] {
    return discoverAvailableModules().map(module => module.name);
}

/**
 * Discovers the members (functions, resources) of a specific module
 */
function discoverModuleMembers(moduleName: string): ModuleMember[] {
    if (!isUnixLikePlatform() || !isUcodeAvailable()) {
        return [];
    }

    try {
        const output = execSync(
            `ucode -e "import * as ${moduleName} from '${moduleName}'; for (thing in ${moduleName}) {print(type(${moduleName}[thing]), ' ', thing, '\\n');}"`,
            { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
        );
        
        const members: ModuleMember[] = [];
        const lines = output.trim().split('\n').filter(line => line.trim().length > 0);
        
        for (const line of lines) {
            const parts = line.trim().split(' ');
            if (parts.length >= 2) {
                const type = parts[0];
                const name = parts.slice(1).join(' '); // Handle names with spaces
                
                let memberType: 'function' | 'resource' | 'constant' | 'unknown' = 'unknown';
                if (type === 'function') {
                    memberType = 'function';
                } else if (type === 'resource') {
                    memberType = 'resource';
                }
                
                members.push({ name, type: memberType });
            }
        }
        
        return members;
    } catch (error) {
        // Silently fail when modules are not available (expected for some modules like nl80211)
        return [];
    }
}

/**
 * Gets members for a specific module
 */
export function getModuleMembers(moduleName: string): ModuleMember[] {
    try {
        const dynamicMembers = discoverModuleMembers(moduleName);
        
        // If dynamic discovery succeeded, use those results
        if (dynamicMembers.length > 0) {
            return dynamicMembers;
        }
        
        // Fallback to static type definitions if available
        return getStaticModuleMembers(moduleName);
    } catch (error) {
        console.warn(`Failed to get module members for ${moduleName}:`, error);
        
        // Try static fallback even on error
        return getStaticModuleMembers(moduleName);
    }
}

/**
 * Gets module members from static type definitions when runtime introspection fails
 */
function getStaticModuleMembers(moduleName: string): ModuleMember[] {
    switch (moduleName) {
        case 'nl80211':
            return getNl80211StaticMembers();
        case 'rtnl':
            return getRtnlStaticMembers();
        case 'socket':
            return getSocketStaticMembers();
        case 'struct':
            return getStructStaticMembers();
        case 'zlib':
            return getZlibStaticMembers();
        case 'ubus':
            return getUbusStaticMembers();
        case 'uci':
            return getUciStaticMembers();
        case 'uloop':
            return getUloopStaticMembers();
        case 'fs':
            return getFsStaticMembers();
        case 'debug':
            return getDebugStaticMembers();
        case 'log':
            return getLogStaticMembers();
        case 'math':
            return getMathStaticMembers();
        case 'digest':
            return getDigestStaticMembers();
        case 'resolv':
            return getResolvStaticMembers();
        default:
            return [];
    }
}

function getNl80211StaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];
    
    // Convert static function definitions to ModuleMember format
    for (const [name] of nl80211Functions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }
    
    // Convert static constant definitions to ModuleMember format
    for (const [name] of nl80211Constants.entries()) {
        members.push({
            name,
            type: 'constant' // Proper semantic type for constants
        });
    }
    
    // Add special 'const' export that represents all constants collectively
    members.push({
        name: 'const',
        type: 'constant'
    });
    
    return members;
}

// Placeholder functions for other modules - implement as needed
function getRtnlStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of rtnlFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    for (const [name] of rtnlConstants.entries()) {
        members.push({
            name,
            type: 'constant'
        });
    }

    // Add special 'const' export that represents all constants collectively
    members.push({
        name: 'const',
        type: 'constant'
    });

    return members;
}
function getSocketStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of socketFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    for (const [name] of socketConstants.entries()) {
        members.push({
            name,
            type: 'constant'
        });
    }

    return members;
}
function getStructStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of structFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    return members;
}
function getZlibStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of zlibFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    for (const [name] of zlibConstants.entries()) {
        members.push({
            name,
            type: 'constant'
        });
    }

    return members;
}
function getUbusStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of ubusFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    for (const [name] of ubusConstants.entries()) {
        members.push({
            name,
            type: 'constant'
        });
    }

    return members;
}
function getUciStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of uciFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    return members;
}
function getUloopStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of uloopFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    for (const [name] of uloopConstants.entries()) {
        members.push({
            name,
            type: 'constant'
        });
    }

    return members;
}
function getFsStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];
    
    // Convert static function definitions to ModuleMember format
    for (const [name] of fsModuleFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }
    
    return members;
}
function getDebugStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of debugFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    return members;
}
function getLogStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of logFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    for (const [name] of logConstants.entries()) {
        members.push({
            name,
            type: 'constant'
        });
    }

    return members;
}
function getMathStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of mathFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    return members;
}
function getDigestStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of digestFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    return members;
}
function getResolvStaticMembers(): ModuleMember[] {
    const members: ModuleMember[] = [];

    for (const [name] of resolvFunctions.entries()) {
        members.push({
            name,
            type: 'function'
        });
    }

    return members;
}

/**
 * Clears the module cache (useful for testing or manual refresh)
 */
export function clearModuleCache(): void {
    cachedModules = null;
    lastCacheTime = 0;
}