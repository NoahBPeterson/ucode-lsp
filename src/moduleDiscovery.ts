import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MODULE_REGISTRIES, KNOWN_MODULES, isKnownModule } from './analysis/moduleDispatch';

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

// Builtin modules — derived from the single source of truth
const BUILTIN_MODULES: readonly string[] = KNOWN_MODULES;

let cachedModules: DiscoveredModule[] | null = null;
let cachedUcodeAvailable: boolean | null = null;
const cachedModuleMembers = new Map<string, ModuleMember[]>();

/**
 * Checks if the current platform supports ucode module discovery
 */
function isUnixLikePlatform(): boolean {
    const platform = os.platform();
    return platform === 'linux' || platform === 'darwin' || platform === 'freebsd' || platform === 'openbsd';
}

/**
 * Checks if ucode command is available (cached once per session)
 */
function isUcodeAvailable(): boolean {
    if (cachedUcodeAvailable !== null) {
        return cachedUcodeAvailable;
    }
    try {
        execSync('command -v ucode', { stdio: 'ignore', timeout: 5000 });
        cachedUcodeAvailable = true;
    } catch {
        cachedUcodeAvailable = false;
    }
    return cachedUcodeAvailable;
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
    // Return cached result (persists for the entire session)
    if (cachedModules) {
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

    // Cache the result for the session
    cachedModules = modules;

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
    // Return cached result if available
    const cached = cachedModuleMembers.get(moduleName);
    if (cached) {
        return cached;
    }

    let members: ModuleMember[];
    try {
        const dynamicMembers = discoverModuleMembers(moduleName);

        // If dynamic discovery succeeded, use those results
        if (dynamicMembers.length > 0) {
            members = dynamicMembers;
        } else {
            // Fallback to static type definitions if available
            members = getStaticModuleMembers(moduleName);
        }
    } catch (error) {
        console.warn(`Failed to get module members for ${moduleName}:`, error);
        members = getStaticModuleMembers(moduleName);
    }

    // Cache for the session
    if (members.length > 0) {
        cachedModuleMembers.set(moduleName, members);
    }

    return members;
}

/**
 * Gets module members from static type definitions when runtime introspection fails
 */
function getStaticModuleMembers(moduleName: string): ModuleMember[] {
    if (!isKnownModule(moduleName)) return [];

    const reg = MODULE_REGISTRIES[moduleName];
    const members: ModuleMember[] = [];

    for (const name of reg.getFunctionNames()) {
        members.push({ name, type: 'function' });
    }

    for (const name of reg.getConstantNames()) {
        members.push({ name, type: 'constant' });
    }

    // nl80211 and rtnl have a special 'const' bulk export
    if (moduleName === 'nl80211' || moduleName === 'rtnl') {
        members.push({ name: 'const', type: 'constant' });
    }

    return members;
}

/**
 * Clears the module cache (useful for testing or manual refresh)
 */
export function clearModuleCache(): void {
    cachedModules = null;
    cachedUcodeAvailable = null;
    cachedModuleMembers.clear();
}