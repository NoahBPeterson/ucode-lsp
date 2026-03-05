/**
 * Central module dispatch layer
 *
 * Single source of truth for module dispatch. Wraps existing module registries
 * with a uniform interface and provides exhaustive dispatch via Effect.js.
 */
import { Option, Either } from 'effect';

// ---- Existing registry imports ----
import { debugTypeRegistry } from './debugTypes';
import { digestTypeRegistry } from './digestTypes';
import { fsModuleTypeRegistry } from './fsModuleTypes';
import { ioModuleTypeRegistry, ioFunctions, ioConstants, ioHandleFunctions } from './ioTypes';
import { logTypeRegistry, logConstants } from './logTypes';
import { mathTypeRegistry } from './mathTypes';
import { nl80211TypeRegistry, nl80211ObjectRegistry, Nl80211ObjectType } from './nl80211Types';
import { resolvTypeRegistry } from './resolvTypes';
import { rtnlTypeRegistry } from './rtnlTypes';
import { socketTypeRegistry } from './socketTypes';
import { structTypeRegistry } from './structTypes';
import { ubusTypeRegistry } from './ubusTypes';
import { uciTypeRegistry } from './uciTypes';
import { uloopTypeRegistry, uloopObjectRegistry, UloopObjectType } from './uloopTypes';
import { zlibTypeRegistry } from './zlibTypes';
import { fsTypeRegistry, FsObjectType } from './fsTypes';
import { exceptionTypeRegistry } from './exceptionTypes';

// ---- Exhaustive union types ----

export const KNOWN_MODULES = [
  'debug', 'digest', 'fs', 'io', 'log', 'math',
  'nl80211', 'resolv', 'rtnl', 'socket', 'struct',
  'ubus', 'uci', 'uloop', 'zlib'
] as const;

export type KnownModule = typeof KNOWN_MODULES[number];

export const KNOWN_OBJECT_TYPES = [
  'fs.file', 'fs.dir', 'fs.proc',
  'io.handle',
  'uloop.timer', 'uloop.handle', 'uloop.process',
  'uloop.task', 'uloop.interval', 'uloop.signal', 'uloop.pipe',
  'uci.cursor',
  'nl80211.listener',
  'exception'
] as const;

export type KnownObjectType = typeof KNOWN_OBJECT_TYPES[number];

// ---- Common function signature (shared shape across all registries) ----

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
  getMethodNames(): string[];
  getMethod(name: string): Option.Option<FunctionSignature>;
  getMethodDocumentation(name: string): Option.Option<string>;
}

export type LookupError =
  | { readonly _tag: 'ModuleNotFound'; readonly name: string }
  | { readonly _tag: 'MemberNotFound'; readonly module: string; readonly member: string };

// ---- Helper: adapt a function signature from any module's format ----
// All module registries use the same shape, so this is a simple cast

function adaptSignature(sig: { name: string; parameters: any[]; returnType: string; description: string } | undefined): Option.Option<FunctionSignature> {
  if (!sig) return Option.none();
  return Option.some(sig as FunctionSignature);
}

// ---- Build MODULE_REGISTRIES ----

function makeSimpleModuleRegistry(
  moduleName: KnownModule,
  registry: {
    getFunctionNames(): string[];
    getFunction(name: string): any;
    getFunctionDocumentation(name: string): string;
  },
  opts?: {
    getConstantNames?: () => string[];
    getConstantDocumentation?: (name: string) => string;
    isValidImport?: (name: string) => boolean;
    getValidImports?: () => string[];
    moduleDocumentation?: string;
  }
): ModuleRegistry {
  return {
    moduleName,
    getFunctionNames: () => registry.getFunctionNames(),
    getFunction: (name: string) => adaptSignature(registry.getFunction(name)),
    getFunctionDocumentation: (name: string) => {
      const doc = registry.getFunctionDocumentation(name);
      return doc ? Option.some(doc) : Option.none();
    },
    getConstantNames: opts?.getConstantNames ?? (() => []),
    getConstantDocumentation: (name: string) => {
      if (!opts?.getConstantDocumentation) return Option.none();
      const doc = opts.getConstantDocumentation(name);
      return doc ? Option.some(doc) : Option.none();
    },
    isValidImport: opts?.isValidImport ?? ((name: string) => registry.getFunctionNames().includes(name)),
    getValidImports: opts?.getValidImports ?? (() => registry.getFunctionNames()),
    getModuleDocumentation: () => opts?.moduleDocumentation ?? `The \`${moduleName}\` module`,
  };
}

const debugRegistry: ModuleRegistry = makeSimpleModuleRegistry('debug', debugTypeRegistry, {
  // debug skips import validation - any import is valid
  isValidImport: () => true,
  getValidImports: () => debugTypeRegistry.getFunctionNames(),
  moduleDocumentation: `## Debug Module

**Runtime debug functionality for ucode scripts**

The debug module provides comprehensive debugging and introspection capabilities for ucode applications.

### Usage

**Named import syntax:**
\`\`\`ucode
import { memdump, traceback } from 'debug';

let stacktrace = traceback(1);
memdump("/tmp/dump.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as debug from 'debug';

let stacktrace = debug.traceback(1);
debug.memdump("/tmp/dump.txt");
\`\`\`

### Available Functions

- **\`memdump()\`** - Write memory dump report to file
- **\`traceback()\`** - Generate stack trace from execution point
- **\`sourcepos()\`** - Get current source position information
- **\`getinfo()\`** - Get detailed information about a value
- **\`getlocal()\`** - Get the value of a local variable
- **\`setlocal()\`** - Set the value of a local variable
- **\`getupval()\`** - Get the value of an upvalue (closure variable)
- **\`setupval()\`** - Set the value of an upvalue (closure variable)

### Environment Variables

- **\`UCODE_DEBUG_MEMDUMP_ENABLED\`** - Enable/disable automatic memory dumps (default: enabled)
- **\`UCODE_DEBUG_MEMDUMP_SIGNAL\`** - Signal for triggering memory dumps (default: SIGUSR2)
- **\`UCODE_DEBUG_MEMDUMP_PATH\`** - Output directory for memory dumps (default: /tmp)

*Hover over individual function names for detailed parameter and return type information.*`,
});

const digestRegistry: ModuleRegistry = makeSimpleModuleRegistry('digest', digestTypeRegistry, {
  // digest skips import validation - any import is valid
  isValidImport: () => true,
  getValidImports: () => digestTypeRegistry.getFunctionNames(),
  moduleDocumentation: `## Digest Module

**Cryptographic hash functions for ucode scripts**

The digest module provides secure hashing functionality using industry-standard algorithms.

### Usage

**Named import syntax:**
\`\`\`ucode
import { md5, sha256, sha1_file } from 'digest';

let hash = md5("Hello World");
let fileHash = sha256_file("/path/to/file.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as digest from 'digest';

let hash = digest.md5("Hello World");
let fileHash = digest.sha256_file("/path/to/file.txt");
\`\`\`

### Available Functions

**String hashing functions:**
- **\`md5()\`** - Calculate MD5 hash of string
- **\`sha1()\`** - Calculate SHA1 hash of string
- **\`sha256()\`** - Calculate SHA256 hash of string
- **\`sha384()\`** - Calculate SHA384 hash of string (extended)
- **\`sha512()\`** - Calculate SHA512 hash of string (extended)
- **\`md2()\`** - Calculate MD2 hash of string (extended)
- **\`md4()\`** - Calculate MD4 hash of string (extended)

**File hashing functions:**
- **\`md5_file()\`** - Calculate MD5 hash of file
- **\`sha1_file()\`** - Calculate SHA1 hash of file
- **\`sha256_file()\`** - Calculate SHA256 hash of file
- **\`sha384_file()\`** - Calculate SHA384 hash of file (extended)
- **\`sha512_file()\`** - Calculate SHA512 hash of file (extended)
- **\`md2_file()\`** - Calculate MD2 hash of file (extended)
- **\`md4_file()\`** - Calculate MD4 hash of file (extended)

### Notes

- Extended algorithms (MD2, MD4, SHA384, SHA512) may not be available on all systems
- All functions return \`null\` on error or invalid input
- File functions return \`null\` if the file cannot be read

*Hover over individual function names for detailed parameter and return type information.*`,
});

const fsRegistry: ModuleRegistry = {
  moduleName: 'fs',
  getFunctionNames: () => fsModuleTypeRegistry.getFunctionNames(),
  getFunction: (name: string) => adaptSignature(fsModuleTypeRegistry.getFunction(name)),
  getFunctionDocumentation: (name: string) => {
    const doc = fsModuleTypeRegistry.getFunctionDocumentation(name);
    return doc ? Option.some(doc) : Option.none();
  },
  getConstantNames: () => [],
  getConstantDocumentation: () => Option.none(),
  isValidImport: (name: string) => fsModuleTypeRegistry.getFunctionNames().includes(name),
  getValidImports: () => fsModuleTypeRegistry.getFunctionNames(),
  getModuleDocumentation: () => `## FS Module

**File system operations for ucode scripts**

The fs module provides comprehensive file system functionality for reading, writing, and manipulating files and directories.

### Usage

**Named import syntax:**
\`\`\`ucode
import { open, readlink, stat } from 'fs';

let file = open("file.txt", "r");
let target = readlink("/sys/class/net/eth0");
let info = stat("/etc/passwd");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as fs from 'fs';

let file = fs.open("file.txt", "r");
let content = file.read("all");
file.close();
\`\`\`

### Available Functions

**File operations:**
- **\`open()\`** - Open files for reading/writing
- **\`fdopen()\`** - Associate file descriptor with handle
- **\`popen()\`** - Execute commands and handle I/O

**Directory operations:**
- **\`opendir()\`** - Open directories for reading
- **\`mkdir()\`** - Create directories
- **\`rmdir()\`** - Remove directories

**File system information:**
- **\`stat()\`** - Get file/directory information
- **\`lstat()\`** - Get info without following symlinks
- **\`readlink()\`** - Read symbolic link targets

**File manipulation:**
- **\`unlink()\`** - Remove files
- **\`symlink()\`** - Create symbolic links
- **\`chmod()\`** - Change file permissions
- **\`chown()\`** - Change file ownership

**Utility functions:**
- **\`error()\`** - Get last error information
- **\`getcwd()\`** - Get current working directory
- **\`chdir()\`** - Change current directory

### File Handle Objects

- **\`fs.file\`** - File handles with read/write/seek methods
- **\`fs.proc\`** - Process handles for command execution
- **\`fs.dir\`** - Directory handles for listing entries

*Hover over individual function names for detailed parameter and return type information.*`,
};

const ioRegistry: ModuleRegistry = {
  moduleName: 'io',
  getFunctionNames: () => Array.from(ioFunctions.keys()),
  getFunction: (name: string) => adaptSignature(ioFunctions.get(name)),
  getFunctionDocumentation: (name: string) => {
    const doc = ioModuleTypeRegistry.getFunctionDocumentation(name);
    return doc ? Option.some(doc) : Option.none();
  },
  getConstantNames: () => Array.from(ioConstants.keys()),
  getConstantDocumentation: (name: string) => {
    const doc = ioModuleTypeRegistry.getConstantDocumentation(name);
    return doc ? Option.some(doc) : Option.none();
  },
  // io skips import validation currently
  isValidImport: (name: string) => ioFunctions.has(name) || ioConstants.has(name),
  getValidImports: () => [...Array.from(ioFunctions.keys()), ...Array.from(ioConstants.keys())],
  getModuleDocumentation: () => `## IO Module

**Object-oriented access to UNIX file descriptors**

The io module provides low-level I/O operations using POSIX file descriptors, with support for terminal control and pseudo-terminal operations.

### Usage

**Named import syntax:**
\`\`\`ucode
import { open, O_RDWR } from 'io';

let handle = open('/tmp/test.txt', O_RDWR);
handle.write('Hello World\\n');
handle.close();
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as io from 'io';

let handle = io.open('/tmp/test.txt', io.O_RDWR);
handle.write('Hello World\\n');
handle.close();
\`\`\`

### Module Functions

- **\`open()\`** - Open a file (POSIX open semantics)
- **\`new()\`** - Create handle from existing fd number
- **\`from()\`** - Create handle from existing file resource
- **\`pipe()\`** - Create a pipe (returns [read, write] handles)
- **\`error()\`** - Get last error message

### Handle Methods

- **\`read()\`**, **\`write()\`** - Read/write data
- **\`seek()\`**, **\`tell()\`** - File position
- **\`dup()\`**, **\`dup2()\`** - Duplicate file descriptors
- **\`fileno()\`** - Get underlying fd number
- **\`fcntl()\`**, **\`ioctl()\`** - File/device control
- **\`isatty()\`** - Test if fd is a terminal
- **\`close()\`** - Close the handle
- **\`ptsname()\`**, **\`grantpt()\`**, **\`unlockpt()\`** - Pseudoterminal ops
- **\`tcgetattr()\`**, **\`tcsetattr()\`** - Terminal attributes

*Hover over individual function names for detailed parameter and return type information.*`,
};

const logRegistry: ModuleRegistry = makeSimpleModuleRegistry('log', logTypeRegistry, {
  getConstantNames: () => Array.from(logConstants),
  getConstantDocumentation: (name: string) => logTypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => logTypeRegistry.isValidLogImport(name),
  getValidImports: () => logTypeRegistry.getValidLogImports(),
  moduleDocumentation: `## Log Module

**System logging functions for ucode scripts**

The log module provides bindings to the POSIX syslog functions as well as OpenWrt specific ulog library functions.

### Usage

**Named import syntax:**
\`\`\`ucode
import { openlog, syslog, LOG_PID, LOG_USER, LOG_ERR } from 'log';

openlog("my-log-ident", LOG_PID, LOG_USER);
syslog(LOG_ERR, "An error occurred!");

// OpenWrt specific ulog functions
import { ulog_open, ulog, ULOG_SYSLOG, LOG_DAEMON, LOG_INFO } from 'log';

ulog_open(ULOG_SYSLOG, LOG_DAEMON, "my-log-ident");
ulog(LOG_INFO, "The current epoch is %d", time());
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as log from 'log';

log.openlog("my-log-ident", log.LOG_PID, log.LOG_USER);
log.syslog(log.LOG_ERR, "An error occurred!");

// OpenWrt specific ulog functions
log.ulog_open(log.ULOG_SYSLOG, log.LOG_DAEMON, "my-log-ident");
log.ulog(log.LOG_INFO, "The current epoch is %d", time());
\`\`\`

### Available Functions

**Standard syslog functions:**
- **\`openlog()\`** - Open connection to system logger
- **\`syslog()\`** - Log a message to the system logger
- **\`closelog()\`** - Close connection to system logger

**OpenWrt ulog functions:**
- **\`ulog_open()\`** - Configure ulog logger
- **\`ulog()\`** - Log a message via ulog mechanism
- **\`ulog_close()\`** - Close ulog logger
- **\`ulog_threshold()\`** - Set ulog priority threshold

**Convenience functions:**
- **\`INFO()\`** - Log with LOG_INFO priority
- **\`NOTE()\`** - Log with LOG_NOTICE priority
- **\`WARN()\`** - Log with LOG_WARNING priority
- **\`ERR()\`** - Log with LOG_ERR priority

### Constants

**Log options:** LOG_PID, LOG_CONS, LOG_NDELAY, LOG_ODELAY, LOG_NOWAIT

**Log facilities:** LOG_AUTH, LOG_AUTHPRIV, LOG_CRON, LOG_DAEMON, LOG_FTP, LOG_KERN, LOG_LPR, LOG_MAIL, LOG_NEWS, LOG_SYSLOG, LOG_USER, LOG_UUCP, LOG_LOCAL0-7

**Log priorities:** LOG_EMERG, LOG_ALERT, LOG_CRIT, LOG_ERR, LOG_WARNING, LOG_NOTICE, LOG_INFO, LOG_DEBUG

**Ulog channels:** ULOG_KMSG, ULOG_STDIO, ULOG_SYSLOG

*Hover over individual function names for detailed parameter and return type information.*`,
});

const mathRegistry: ModuleRegistry = makeSimpleModuleRegistry('math', mathTypeRegistry, {
  isValidImport: (name: string) => mathTypeRegistry.isValidMathImport(name),
  getValidImports: () => mathTypeRegistry.getValidMathImports(),
  moduleDocumentation: `## Math Module

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
});

const nl80211Registry: ModuleRegistry = makeSimpleModuleRegistry('nl80211', nl80211TypeRegistry, {
  getConstantNames: () => nl80211TypeRegistry.getConstantNames(),
  getConstantDocumentation: (name: string) => nl80211TypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => nl80211TypeRegistry.isValidNl80211Import(name),
  getValidImports: () => nl80211TypeRegistry.getValidImports(),
  moduleDocumentation: `## NL80211 Module

**WiFi/802.11 networking interface for ucode scripts**

The nl80211 module provides access to the Linux kernel's nl80211 subsystem for managing WiFi interfaces and wireless networking operations.

### Usage

**Named import syntax:**
\`\`\`ucode
import { request, waitfor, listener, error } from 'nl80211';
import { NL80211_CMD_GET_WIPHY, NL80211_CMD_TRIGGER_SCAN } from 'nl80211';

// Request wireless interface information
let result = request(NL80211_CMD_GET_WIPHY, NLM_F_DUMP);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as nl80211 from 'nl80211';

// Trigger a scan and wait for results
let result = nl80211.request(nl80211.NL80211_CMD_TRIGGER_SCAN, nl80211.NLM_F_ACK);
let scanResults = nl80211.waitfor([nl80211.NL80211_CMD_NEW_SCAN_RESULTS], 10000);
\`\`\`

### Available Functions

**Core operations:**
- **\`request()\`** - Send netlink request to nl80211 subsystem
- **\`waitfor()\`** - Wait for specific nl80211 events
- **\`listener()\`** - Create event listener for nl80211 messages
- **\`error()\`** - Get last error information

### Available Constants

**Netlink flags:**
- **NLM_F_*** - Request flags (ACK, DUMP, CREATE, etc.)

**NL80211 commands:**
- **NL80211_CMD_*** - WiFi interface commands (GET_WIPHY, TRIGGER_SCAN, etc.)

**Interface types:**
- **NL80211_IFTYPE_*** - WiFi interface types (STATION, AP, MONITOR, etc.)

**Hardware simulator:**
- **HWSIM_CMD_*** - Commands for mac80211_hwsim testing

### Notes

- Requires root privileges or appropriate capabilities
- Used for WiFi interface management, scanning, and monitoring
- Integrates with OpenWrt's wireless configuration system
- Event-driven architecture for asynchronous operations

*Hover over individual function names and constants for detailed parameter and return type information.*`,
});

const resolvRegistry: ModuleRegistry = makeSimpleModuleRegistry('resolv', resolvTypeRegistry, {
  isValidImport: (name: string) => resolvTypeRegistry.isValidImport(name),
  getValidImports: () => resolvTypeRegistry.getValidImports(),
  moduleDocumentation: `## Resolv Module

**DNS resolution functionality for ucode scripts**

The resolv module provides DNS resolution functionality for ucode, allowing you to perform DNS queries for various record types and handle responses.

### Usage

**Named import syntax:**
\`\`\`ucode
import { query, error } from 'resolv';

let result = query('example.com', { type: ['A'] });
if (!result) {
    let err = error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as resolv from 'resolv';

let result = resolv.query('example.com', { type: ['A'] });
if (!result) {
    let err = resolv.error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

### Available Functions

**Core operations:**
- **\`query()\`** - Perform DNS queries for specified domain names
- **\`error()\`** - Get the last error message from DNS operations

### Supported DNS Record Types

- **A** - IPv4 address record
- **AAAA** - IPv6 address record
- **CNAME** - Canonical name record
- **MX** - Mail exchange record
- **NS** - Name server record
- **PTR** - Pointer record (reverse DNS)
- **SOA** - Start of authority record
- **SRV** - Service record
- **TXT** - Text record
- **ANY** - Any available record type

### Response Codes

- **NOERROR** - Query successful
- **FORMERR** - Format error in query
- **SERVFAIL** - Server failure
- **NXDOMAIN** - Non-existent domain
- **NOTIMP** - Not implemented
- **REFUSED** - Query refused
- **TIMEOUT** - Query timed out

### Examples

Basic A record lookup:
\`\`\`ucode
const result = query(['example.com']);
\`\`\`

Specific record type query:
\`\`\`ucode
const mxRecords = query(['example.com'], { type: ['MX'] });
\`\`\`

Multiple domains with custom nameserver:
\`\`\`ucode
const results = query(['example.com', 'google.com'], {
    type: ['A', 'MX'],
    nameserver: ['8.8.8.8', '1.1.1.1'],
    timeout: 10000
});
\`\`\`

Reverse DNS lookup:
\`\`\`ucode
const ptrResult = query(['192.0.2.1'], { type: ['PTR'] });
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`,
});

const rtnlRegistry: ModuleRegistry = makeSimpleModuleRegistry('rtnl', rtnlTypeRegistry, {
  getConstantNames: () => rtnlTypeRegistry.getConstantNames(),
  getConstantDocumentation: (name: string) => rtnlTypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => rtnlTypeRegistry.isValidRtnlImport(name),
  getValidImports: () => rtnlTypeRegistry.getValidImports(),
  moduleDocumentation: `## RTNL Module
**Routing Netlink functionality for ucode scripts**

The rtnl module provides routing netlink functionality for ucode, allowing you to interact with the Linux kernel's routing and network interface subsystem.

### Usage

**Named import syntax:**
\`\`\`ucode
import { request, listener, error } from 'rtnl';
// Send routing request
let result = request(RTM_GETROUTE, NLM_F_DUMP);
\`\`\`

**Constants import syntax:**
\`\`\`ucode
import { 'const' as rtnlconst } from 'rtnl';
let routeType = rtnlconst.RTN_UNICAST;
let tableId = rtnlconst.RT_TABLE_MAIN;
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as rtnl from 'rtnl';
let result = rtnl.request(rtnl.RTM_GETROUTE, rtnl.NLM_F_DUMP);
\`\`\`

### Available Functions

**Core operations:**
- **\`request()\`** - Send netlink request to routing subsystem
- **\`listener()\`** - Create event listener for routing messages
- **\`error()\`** - Get last error information

### Available Constants

**Route types:**
- **RTN_UNICAST** - Gateway or direct route
- **RTN_LOCAL** - Accept locally
- **RTN_BROADCAST** - Accept locally as broadcast

**Route tables:**
- **RT_TABLE_UNSPEC** - Unspecified table
- **RT_TABLE_MAIN** - Main routing table
- **RT_TABLE_LOCAL** - Local routing table

**Bridge flags:**
- **BRIDGE_FLAGS_MASTER** - Bridge master flag
- **BRIDGE_FLAGS_SELF** - Bridge self flag

*Hover over individual function and constant names for detailed information.*`,
});

const socketRegistry: ModuleRegistry = makeSimpleModuleRegistry('socket', socketTypeRegistry, {
  getConstantNames: () => socketTypeRegistry.getConstantNames(),
  getConstantDocumentation: (name: string) => socketTypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => socketTypeRegistry.isValidImport(name),
  getValidImports: () => socketTypeRegistry.getValidImports(),
  moduleDocumentation: `## Socket Module

**Network socket functionality for ucode scripts**

The socket module provides comprehensive network socket functionality for creating TCP/UDP connections, listening for incoming connections, and handling network communication.

### Usage

**Named import syntax:**
\`\`\`ucode
import { create, connect, listen, AF_INET, SOCK_STREAM } from 'socket';

// Create a TCP socket
let sock = create(AF_INET, SOCK_STREAM);
let result = connect(sock, "192.168.1.1", "80");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as socket from 'socket';

// Create a UDP socket
let sock = socket.create(socket.AF_INET, socket.SOCK_DGRAM);
let result = socket.connect(sock, "8.8.8.8", "53");
\`\`\`

### Available Functions

**Socket creation and connection:**
- **\`create()\`** - Create a new socket with specified domain, type, and protocol
- **\`connect()\`** - Connect socket to a remote address
- **\`listen()\`** - Listen for incoming connections on a socket

**Address resolution:**
- **\`sockaddr()\`** - Create socket address structures
- **\`addrinfo()\`** - Resolve hostnames and service names to addresses
- **\`nameinfo()\`** - Convert addresses back to hostnames

**I/O operations:**
- **\`poll()\`** - Wait for events on multiple sockets

**Error handling:**
- **\`error()\`** - Get socket error information
- **\`strerror()\`** - Convert error codes to human-readable strings

### Socket Constants

**Address Families:**
- **AF_INET** - IPv4 Internet protocols
- **AF_INET6** - IPv6 Internet protocols
- **AF_UNIX** - Unix domain sockets

**Socket Types:**
- **SOCK_STREAM** - TCP (reliable, connection-oriented)
- **SOCK_DGRAM** - UDP (unreliable, connectionless)
- **SOCK_RAW** - Raw sockets

**Socket Options:**
- **SOL_SOCKET**, **SO_REUSEADDR**, **SO_KEEPALIVE**, etc.

**Message Flags:**
- **MSG_DONTWAIT**, **MSG_NOSIGNAL**, **MSG_PEEK**, etc.

**Protocols:**
- **IPPROTO_TCP**, **IPPROTO_UDP**, **IPPROTO_IP**, etc.

**Poll Events:**
- **POLLIN**, **POLLOUT**, **POLLERR**, **POLLHUP**, etc.

### Examples

Create and connect TCP socket:
\`\`\`ucode
let sock = create(AF_INET, SOCK_STREAM);
if (connect(sock, "example.com", "80") == 0) {
    print("Connected successfully\\n");
}
\`\`\`

Create UDP server:
\`\`\`ucode
let sock = create(AF_INET, SOCK_DGRAM);
listen(sock, "0.0.0.0", "8080");
\`\`\`

Wait for socket events:
\`\`\`ucode
let result = poll([{fd: sock, events: POLLIN}], 5000);
\`\`\`

*Hover over individual function names and constants for detailed parameter and return type information.*`,
});

const structRegistry: ModuleRegistry = makeSimpleModuleRegistry('struct', structTypeRegistry, {
  isValidImport: (name: string) => structTypeRegistry.isValidImport(name),
  getValidImports: () => structTypeRegistry.getValidImports(),
  moduleDocumentation: `## Struct Module

**Binary data packing/unpacking module for ucode scripts**

The struct module provides routines for interpreting byte strings as packed binary data, similar to Python's struct module.

### Usage

**Named import syntax:**
\`\`\`ucode
import { pack, unpack } from 'struct';

let buffer = pack('bhl', -13, 1234, 444555666);
let values = unpack('bhl', buffer);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as struct from 'struct';

let buffer = struct.pack('bhl', -13, 1234, 444555666);
let values = struct.unpack('bhl', buffer);
\`\`\`

### Available Functions

**Core functions:**
- **\`pack()\`** - Pack values into binary string according to format
- **\`unpack()\`** - Unpack binary string into values according to format
- **\`new()\`** - Create precompiled format instance for efficiency
- **\`buffer()\`** - Create struct buffer for incremental operations

### Format String Syntax

**Format characters:**
- **\`b/B\`** - signed/unsigned char (1 byte)
- **\`h/H\`** - signed/unsigned short (2 bytes)
- **\`i/I\`** - signed/unsigned int (4 bytes)
- **\`l/L\`** - signed/unsigned long (4 bytes)
- **\`q/Q\`** - signed/unsigned long long (8 bytes)
- **\`f\`** - float (4 bytes)
- **\`d\`** - double (8 bytes)
- **\`s\`** - string
- **\`?\`** - boolean

**Byte order prefixes:**
- **\`@\`** - native (default)
- **\`<\`** - little-endian
- **\`>\`** - big-endian
- **\`!\`** - network (big-endian)

### Examples

\`\`\`ucode
// Pack three integers as network byte order
let data = pack('!III', 1, 2, 3);

// Unpack the same data
let [a, b, c] = unpack('!III', data);

// Use precompiled format for efficiency
let fmt = struct.new('!III');
let packed = fmt.pack(1, 2, 3);
let unpacked = fmt.unpack(packed);
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`,
});

const ubusRegistry: ModuleRegistry = makeSimpleModuleRegistry('ubus', ubusTypeRegistry, {
  getConstantNames: () => ubusTypeRegistry.getConstantNames(),
  getConstantDocumentation: (name: string) => ubusTypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => ubusTypeRegistry.isValidImport(name),
  getValidImports: () => ubusTypeRegistry.getValidImports(),
  moduleDocumentation: `## ubus Module

**OpenWrt unified bus communication for ucode scripts**

The ubus module provides comprehensive access to the OpenWrt unified bus (ubus) system, enabling communication with system services and daemons.

### Usage

**Named import syntax:**
\`\`\`ucode
import { connect, error, STATUS_OK } from 'ubus';

let conn = connect();
if (conn) {
    let objects = conn.list();
    print("Available objects:", length(objects));
} else {
    print("Connection failed:", error());
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as ubus from 'ubus';

let conn = ubus.connect();
if (conn) {
    let result = conn.call("system", "info", {});
    print("System info:", result);
}
\`\`\`

### Available Functions

- **\`connect()\`** - Establish connection to ubus daemon
- **\`error()\`** - Retrieve last ubus error information
- **\`open_channel()\`** - Create bidirectional ubus channel
- **\`guard()\`** - Set/get global ubus exception handler

### Status Constants

- **\`STATUS_OK\`** - Operation completed successfully
- **\`STATUS_INVALID_COMMAND\`** - Invalid or unknown command
- **\`STATUS_INVALID_ARGUMENT\`** - Invalid argument provided
- **\`STATUS_METHOD_NOT_FOUND\`** - Requested method not found
- **\`STATUS_NOT_FOUND\`** - Requested object not found
- **\`STATUS_NO_DATA\`** - No data available
- **\`STATUS_PERMISSION_DENIED\`** - Access denied
- **\`STATUS_TIMEOUT\`** - Operation timed out
- **\`STATUS_NOT_SUPPORTED\`** - Operation not supported
- **\`STATUS_UNKNOWN_ERROR\`** - Unknown error occurred
- **\`STATUS_CONNECTION_FAILED\`** - Connection failed

### Connection Methods

Once connected, the connection object provides methods like:
- **\`list()\`** - List available ubus objects
- **\`call()\`** - Call methods on ubus objects
- **\`publish()\`** - Publish ubus objects
- **\`listener()\`** - Register event listeners
- **\`subscriber()\`** - Create subscriptions

### Additional Information

The ubus module is specifically designed for OpenWrt systems and requires the ubus daemon to be running. It provides both synchronous and asynchronous communication patterns for maximum flexibility.

*Hover over individual function names for detailed parameter and return type information.*`,
});

const uciRegistry: ModuleRegistry = makeSimpleModuleRegistry('uci', uciTypeRegistry, {
  isValidImport: (name: string) => uciTypeRegistry.isValidImport(name),
  getValidImports: () => uciTypeRegistry.getValidImports(),
  moduleDocumentation: `## UCI Module

**OpenWrt UCI configuration interface for ucode scripts**

The uci module provides access to the native OpenWrt libuci API for reading and manipulating UCI configuration files.

### Usage

**Named import syntax:**
\`\`\`ucode
import { cursor } from 'uci';

let ctx = cursor();
let hostname = ctx.get_first('system', 'system', 'hostname');
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as uci from 'uci';

let ctx = uci.cursor();
let hostname = ctx.get_first('system', 'system', 'hostname');
\`\`\`

### Available Functions

- **\`error()\`** - Query error information
- **\`cursor()\`** - Instantiate uci cursor for configuration manipulation

### UCI Cursor Methods

The cursor object provides comprehensive methods for configuration management:

- **Configuration Management**: \`load()\`, \`unload()\`, \`configs()\`
- **Data Access**: \`get()\`, \`get_all()\`, \`get_first()\`, \`foreach()\`
- **Data Modification**: \`add()\`, \`set()\`, \`delete()\`, \`rename()\`, \`reorder()\`
- **List Operations**: \`list_append()\`, \`list_remove()\`
- **Change Management**: \`save()\`, \`commit()\`, \`revert()\`, \`changes()\`

### Configuration Files

UCI configurations are stored in \`/etc/config/\` and can be manipulated through the cursor interface:

\`\`\`ucode
let ctx = cursor();

// Read configuration values
let hostname = ctx.get('system', '@system[0]', 'hostname');

// Modify configuration
ctx.set('system', '@system[0]', 'hostname', 'new-hostname');
ctx.commit('system');
\`\`\`

### Additional Information

The uci module is specifically designed for OpenWrt systems and provides safe, transactional access to system configuration files with support for delta records and change tracking.

*Hover over individual function names for detailed parameter and return type information.*`,
});

const uloopRegistry: ModuleRegistry = makeSimpleModuleRegistry('uloop', uloopTypeRegistry, {
  getConstantNames: () => uloopTypeRegistry.getConstantNames(),
  getConstantDocumentation: (name: string) => uloopTypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => uloopTypeRegistry.isValidImport(name),
  getValidImports: () => uloopTypeRegistry.getValidImports(),
  moduleDocumentation: `**uloop** - OpenWrt uloop event loop module

Provides event-driven programming capabilities for handling timers, file descriptors, processes, signals, and background tasks.

### Core Functions

- **\`init()\`** - Initialize the event loop
- **\`run([timeout])\`** - Run the event loop
- **\`end()\`** - Stop the event loop
- **\`done()\`** - Stop and cleanup the event loop

### Event Objects

- **\`timer(timeout, callback)\`** - Create timer objects
- **\`handle(fd, callback, events)\`** - Monitor file descriptors
- **\`process(cmd, args, env, callback)\`** - Execute external processes
- **\`task(taskFunc, outputCb, inputCb)\`** - Run background tasks
- **\`interval(timeout, callback)\`** - Create repeating timers
- **\`signal(signal, callback)\`** - Handle Unix signals

### Constants

- **\`ULOOP_READ\`** (1) - Monitor for read events
- **\`ULOOP_WRITE\`** (2) - Monitor for write events
- **\`ULOOP_EDGE_TRIGGER\`** (4) - Use edge-triggered mode
- **\`ULOOP_BLOCKING\`** (8) - Keep descriptor blocking

### Usage Examples

\`\`\`ucode
import * as uloop from 'uloop';

uloop.init();

// Create a timer
let timer = uloop.timer(1000, () => {
    printf("Timer fired!\\n");
});

// Monitor a file descriptor
let handle = uloop.handle(fd, (events) => {
    if (events & uloop.ULOOP_READ) {
        // Handle read event
    }
}, uloop.ULOOP_READ);

// Run the event loop
uloop.run();
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`,
});

const zlibRegistry: ModuleRegistry = makeSimpleModuleRegistry('zlib', zlibTypeRegistry, {
  getConstantNames: () => zlibTypeRegistry.getConstantNames(),
  getConstantDocumentation: (name: string) => zlibTypeRegistry.getConstantDocumentation(name),
  isValidImport: (name: string) => zlibTypeRegistry.isValidImport(name),
  getValidImports: () => zlibTypeRegistry.getValidImports(),
  moduleDocumentation: `## Zlib Module

**Data compression and decompression module**

The zlib module provides single-call and stream-oriented functions for interacting with zlib data compression.

### Usage

**Named import syntax:**
\`\`\`ucode
import { deflate, inflate, Z_BEST_SPEED, Z_NO_FLUSH } from 'zlib';

const compressed = deflate("Hello World!", true, Z_BEST_SPEED);
const decompressed = inflate(compressed);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as zlib from 'zlib';

const compressed = zlib.deflate("Hello World!");
const decompressed = zlib.inflate(compressed);

// Streaming compression
const deflater = zlib.deflater(false, zlib.Z_DEFAULT_COMPRESSION);
deflater.write("data chunk", zlib.Z_NO_FLUSH);
const result = deflater.read();
\`\`\`

### Available Functions

- **\`deflate()\`** - Compresses data in Zlib or gzip format
- **\`inflate()\`** - Decompresses data in Zlib or gzip format
- **\`deflater()\`** - Initialize a deflate stream for streaming compression
- **\`inflater()\`** - Initialize an inflate stream for streaming decompression

### Compression Levels

- **\`Z_NO_COMPRESSION\`** (0) - No compression
- **\`Z_BEST_SPEED\`** (1) - Fastest compression
- **\`Z_BEST_COMPRESSION\`** (9) - Maximum compression
- **\`Z_DEFAULT_COMPRESSION\`** (-1) - Default balance of speed/compression

### Flush Options

- **\`Z_NO_FLUSH\`** (0) - No flushing, accumulate data
- **\`Z_PARTIAL_FLUSH\`** (1) - Partial flush without closing stream
- **\`Z_SYNC_FLUSH\`** (2) - Sync flush, align to byte boundary
- **\`Z_FULL_FLUSH\`** (3) - Full flush, reset compression state
- **\`Z_FINISH\`** (4) - Finish stream, no more input expected

### Additional Information

Supports both single-call compression/decompression and streaming operations. The streaming API allows processing large amounts of data in chunks without loading everything into memory.

*Hover over individual function names for detailed parameter and return type information.*`,
});

export const MODULE_REGISTRIES: Record<KnownModule, ModuleRegistry> = {
  debug: debugRegistry,
  digest: digestRegistry,
  fs: fsRegistry,
  io: ioRegistry,
  log: logRegistry,
  math: mathRegistry,
  nl80211: nl80211Registry,
  resolv: resolvRegistry,
  rtnl: rtnlRegistry,
  socket: socketRegistry,
  struct: structRegistry,
  ubus: ubusRegistry,
  uci: uciRegistry,
  uloop: uloopRegistry,
  zlib: zlibRegistry,
};

// ---- Build OBJECT_REGISTRIES ----

// Adapter for fs object types (fs.file, fs.dir, fs.proc)
function makeFsObjectRegistry(fsType: FsObjectType): ObjectTypeRegistry {
  return {
    objectType: fsType as KnownObjectType,
    getMethodNames: () => fsTypeRegistry.getMethodsForType(fsType),
    getMethod: (name: string) => {
      const method = fsTypeRegistry.getFsMethod(fsType, name);
      if (!method) return Option.none();
      // fs methods use UcodeType enum for params/return, adapt to FunctionSignature
      return Option.some({
        name: method.name,
        parameters: method.parameters.map((p, i) => ({
          name: `arg${i}`,
          type: String(p),
          optional: false,
        })),
        returnType: String(method.returnType),
        description: method.description || '',
      });
    },
    getMethodDocumentation: (name: string) => {
      const method = fsTypeRegistry.getFsMethod(fsType, name);
      if (!method) return Option.none();
      return Option.some(
        `**${fsType}.${method.name}()**: \`${method.returnType}\`\n\n${method.description || ''}`
      );
    },
  };
}

// Adapter for io.handle
const ioHandleObjectRegistry: ObjectTypeRegistry = {
  objectType: 'io.handle',
  getMethodNames: () => Array.from(ioHandleFunctions.keys()),
  getMethod: (name: string) => adaptSignature(ioHandleFunctions.get(name)),
  getMethodDocumentation: (name: string) => {
    const doc = ioModuleTypeRegistry.getHandleFunctionDocumentation(name);
    return doc ? Option.some(doc) : Option.none();
  },
};

// Adapter for uloop object types
function makeUloopObjectRegistry(uloopType: UloopObjectType): ObjectTypeRegistry {
  return {
    objectType: uloopType as KnownObjectType,
    getMethodNames: () => uloopObjectRegistry.getMethodsForType(uloopType),
    getMethod: (name: string) => adaptSignature(uloopObjectRegistry.getUloopMethod(uloopType, name)),
    getMethodDocumentation: (name: string) => {
      const method = uloopObjectRegistry.getUloopMethod(uloopType, name);
      if (!method) return Option.none();
      const params = method.parameters.map(p => {
        const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
        return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
      }).join(', ');
      return Option.some(
        `**${uloopType.split('.')[1]}.${method.name}(${params}): ${method.returnType}**\n\n${method.description}`
      );
    },
  };
}

// Adapter for uci.cursor
const uciCursorObjectRegistryAdapter: ObjectTypeRegistry = {
  objectType: 'uci.cursor',
  getMethodNames: () => uciTypeRegistry.getCursorMethodNames(),
  getMethod: (name: string) => adaptSignature(uciTypeRegistry.getCursorMethod(name)),
  getMethodDocumentation: (name: string) => {
    const doc = uciTypeRegistry.getCursorMethodDocumentation(name);
    return doc ? Option.some(doc) : Option.none();
  },
};

// Adapter for nl80211.listener
const nl80211ListenerObjectRegistry: ObjectTypeRegistry = {
  objectType: 'nl80211.listener',
  getMethodNames: () => nl80211ObjectRegistry.getMethodsForType(Nl80211ObjectType.NL80211_LISTENER),
  getMethod: (name: string) => adaptSignature(nl80211ObjectRegistry.getNl80211Method(Nl80211ObjectType.NL80211_LISTENER, name)),
  getMethodDocumentation: (name: string) => {
    const method = nl80211ObjectRegistry.getNl80211Method(Nl80211ObjectType.NL80211_LISTENER, name);
    if (!method) return Option.none();
    const params = method.parameters.map(p => {
      const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
      return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
    }).join(', ');
    return Option.some(
      `**listener.${method.name}(${params}): ${method.returnType}**\n\n${method.description}`
    );
  },
};

// Adapter for exception object (properties, not methods, but we expose them as "methods" for uniform dispatch)
const exceptionObjectRegistry: ObjectTypeRegistry = {
  objectType: 'exception',
  getMethodNames: () => exceptionTypeRegistry.getPropertyNames(),
  getMethod: (name: string) => {
    const prop = exceptionTypeRegistry.getProperty(name);
    if (!prop) return Option.none();
    return Option.some({
      name: prop.name,
      parameters: [],
      returnType: prop.type,
      description: prop.description,
    });
  },
  getMethodDocumentation: (name: string) => {
    const doc = exceptionTypeRegistry.getPropertyDocumentation(name);
    return doc ? Option.some(doc) : Option.none();
  },
};

export const OBJECT_REGISTRIES: Record<KnownObjectType, ObjectTypeRegistry> = {
  'fs.file': makeFsObjectRegistry(FsObjectType.FS_FILE),
  'fs.dir': makeFsObjectRegistry(FsObjectType.FS_DIR),
  'fs.proc': makeFsObjectRegistry(FsObjectType.FS_PROC),
  'io.handle': ioHandleObjectRegistry,
  'uloop.timer': makeUloopObjectRegistry(UloopObjectType.ULOOP_TIMER),
  'uloop.handle': makeUloopObjectRegistry(UloopObjectType.ULOOP_HANDLE),
  'uloop.process': makeUloopObjectRegistry(UloopObjectType.ULOOP_PROCESS),
  'uloop.task': makeUloopObjectRegistry(UloopObjectType.ULOOP_TASK),
  'uloop.interval': makeUloopObjectRegistry(UloopObjectType.ULOOP_INTERVAL),
  'uloop.signal': makeUloopObjectRegistry(UloopObjectType.ULOOP_SIGNAL),
  'uloop.pipe': makeUloopObjectRegistry(UloopObjectType.ULOOP_PIPE),
  'uci.cursor': uciCursorObjectRegistryAdapter,
  'nl80211.listener': nl80211ListenerObjectRegistry,
  'exception': exceptionObjectRegistry,
};

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

// ---- Dispatch functions ----

/**
 * Get documentation for a module member (function or constant).
 * Replaces the 22-branch member hover chain.
 */
export function getModuleMemberDocumentation(m: KnownModule, member: string): Option.Option<string> {
  const reg = MODULE_REGISTRIES[m];
  // Try function documentation first
  const funcDoc = reg.getFunctionDocumentation(member);
  if (Option.isSome(funcDoc)) return funcDoc;
  // Then try constant documentation
  return reg.getConstantDocumentation(member);
}

/**
 * Get documentation for an imported symbol.
 * Replaces the 16-branch imported symbol hover chain.
 */
export function getImportedSymbolDocumentation(m: KnownModule, name: string): Option.Option<string> {
  const reg = MODULE_REGISTRIES[m];
  // Try function doc first
  const funcDoc = reg.getFunctionDocumentation(name);
  if (Option.isSome(funcDoc)) return funcDoc;
  // Try constant doc
  const constDoc = reg.getConstantDocumentation(name);
  if (Option.isSome(constDoc)) return constDoc;
  // Fall back to module-level doc
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
 * Replaces the typeChecker.ts method resolution chain.
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
