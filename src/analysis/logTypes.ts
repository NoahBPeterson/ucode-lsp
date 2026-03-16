/**
 * Log module type definitions and function signatures
 * Based on ucode/lib/log.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["openlog", {
    name: "openlog",
    parameters: [
      { name: "ident", type: "string", optional: true },
      { name: "options", type: "number | string | string[]", optional: true },
      { name: "facility", type: "number | string", optional: true, defaultValue: "user" }
    ],
    returnType: "boolean",
    description: "Open connection to system logger. Establishes a connection to the system log service and configures the default facility and identification for subsequent log operations."
  }],
  ["syslog", {
    name: "syslog",
    parameters: [
      { name: "priority", type: "number | string", optional: false },
      { name: "format", type: "any", optional: false },
      { name: "args", type: "any", optional: true }
    ],
    returnType: "boolean",
    description: "Log a message to the system logger. Behaves in a sprintf-like manner, allowing the use of format strings and associated arguments to construct log messages."
  }],
  ["closelog", {
    name: "closelog",
    parameters: [],
    returnType: "null",
    description: "Close connection to system logger. The usage of this function is optional, and usually an explicit log connection tear down is not required."
  }],
  ["ulog_open", {
    name: "ulog_open",
    parameters: [
      { name: "channels", type: "number | string | string[]", optional: true },
      { name: "facility", type: "number | string", optional: true },
      { name: "ident", type: "string", optional: true }
    ],
    returnType: "boolean",
    description: "Configure ulog logger (OpenWrt specific). Configures the ulog mechanism and is analogous to using openlog() in conjunction with syslog()."
  }],
  ["ulog", {
    name: "ulog",
    parameters: [
      { name: "priority", type: "number | string", optional: false },
      { name: "format", type: "any", optional: false },
      { name: "args", type: "any", optional: true }
    ],
    returnType: "boolean",
    description: "Log a message via the ulog mechanism (OpenWrt specific). Outputs the given log message to all configured ulog channels unless the given priority level exceeds the globally configured ulog priority threshold."
  }],
  ["ulog_close", {
    name: "ulog_close",
    parameters: [],
    returnType: "null",
    description: "Close ulog logger (OpenWrt specific). Resets the ulog channels, the default facility and the log ident value to defaults."
  }],
  ["ulog_threshold", {
    name: "ulog_threshold",
    parameters: [
      { name: "priority", type: "number | string", optional: true }
    ],
    returnType: "boolean",
    description: "Set ulog priority threshold (OpenWrt specific). Configures the application wide log message threshold for log messages emitted with ulog()."
  }],
  ["INFO", {
    name: "INFO",
    parameters: [
      { name: "format", type: "any", optional: false },
      { name: "args", type: "any", optional: true }
    ],
    returnType: "boolean",
    description: "Convenience wrapper for ulog(LOG_INFO, ...). Logs a message with LOG_INFO priority using the ulog mechanism."
  }],
  ["NOTE", {
    name: "NOTE",
    parameters: [
      { name: "format", type: "any", optional: false },
      { name: "args", type: "any", optional: true }
    ],
    returnType: "boolean",
    description: "Convenience wrapper for ulog(LOG_NOTICE, ...). Logs a message with LOG_NOTICE priority using the ulog mechanism."
  }],
  ["WARN", {
    name: "WARN",
    parameters: [
      { name: "format", type: "any", optional: false },
      { name: "args", type: "any", optional: true }
    ],
    returnType: "boolean",
    description: "Convenience wrapper for ulog(LOG_WARNING, ...). Logs a message with LOG_WARNING priority using the ulog mechanism."
  }],
  ["ERR", {
    name: "ERR",
    parameters: [
      { name: "format", type: "any", optional: false },
      { name: "args", type: "any", optional: true }
    ],
    returnType: "boolean",
    description: "Convenience wrapper for ulog(LOG_ERR, ...). Logs a message with LOG_ERR priority using the ulog mechanism."
  }]
]);

// Backwards-compat export
export { functions as logFunctions };
export type LogFunctionSignature = FunctionSignature;

// Valid log module constants (from log.c)
export const logConstants = new Set([
  // Log options
  'LOG_PID', 'LOG_CONS', 'LOG_NDELAY', 'LOG_ODELAY', 'LOG_NOWAIT',

  // Log facilities
  'LOG_AUTH', 'LOG_AUTHPRIV', 'LOG_CRON', 'LOG_DAEMON', 'LOG_FTP', 'LOG_KERN',
  'LOG_LPR', 'LOG_MAIL', 'LOG_NEWS', 'LOG_SYSLOG', 'LOG_USER', 'LOG_UUCP',
  'LOG_LOCAL0', 'LOG_LOCAL1', 'LOG_LOCAL2', 'LOG_LOCAL3', 'LOG_LOCAL4',
  'LOG_LOCAL5', 'LOG_LOCAL6', 'LOG_LOCAL7',

  // Log priorities
  'LOG_EMERG', 'LOG_ALERT', 'LOG_CRIT', 'LOG_ERR', 'LOG_WARNING', 'LOG_NOTICE',
  'LOG_INFO', 'LOG_DEBUG',

  // Ulog channels (OpenWrt specific)
  'ULOG_KMSG', 'ULOG_SYSLOG', 'ULOG_STDIO'
]);

// Log constant documentation
export const logConstantDocs = new Map<string, string>([
  // Log options
  ['LOG_PID', '**LOG_PID** - Include PID with each message.\n\n*Log Option Constant*\n\nWhen passed to `openlog()`, this option includes the process ID (PID) with each log message.'],
  ['LOG_CONS', '**LOG_CONS** - Log to console if error occurs while sending to syslog.\n\n*Log Option Constant*\n\nWhen passed to `openlog()`, this option causes messages to be written to the system console if there is an error while sending to syslog.'],
  ['LOG_NDELAY', '**LOG_NDELAY** - Open the connection to the logger immediately.\n\n*Log Option Constant*\n\nWhen passed to `openlog()`, this option opens the connection to the logger immediately instead of waiting for the first message.'],
  ['LOG_ODELAY', '**LOG_ODELAY** - Delay open until the first message is logged.\n\n*Log Option Constant*\n\nWhen passed to `openlog()`, this option delays opening the connection until the first message is logged.'],
  ['LOG_NOWAIT', '**LOG_NOWAIT** - Do not wait for child processes created during logging.\n\n*Log Option Constant*\n\nWhen passed to `openlog()`, this option prevents waiting for child processes that might be created during logging.'],

  // Log facilities
  ['LOG_AUTH', '**LOG_AUTH** - Authentication/authorization messages.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to authentication or authorization.'],
  ['LOG_AUTHPRIV', '**LOG_AUTHPRIV** - Private authentication messages.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to private authentication.'],
  ['LOG_CRON', '**LOG_CRON** - Clock daemon (cron and at commands).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to the cron daemon.'],
  ['LOG_DAEMON', '**LOG_DAEMON** - System daemons without separate facility values.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to system daemons.'],
  ['LOG_FTP', '**LOG_FTP** - FTP server daemon.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to the FTP server.'],
  ['LOG_KERN', '**LOG_KERN** - Kernel messages.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to the kernel.'],
  ['LOG_LPR', '**LOG_LPR** - Line printer subsystem.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to the line printer subsystem.'],
  ['LOG_MAIL', '**LOG_MAIL** - Mail system.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to the mail system.'],
  ['LOG_NEWS', '**LOG_NEWS** - Network news subsystem.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to network news.'],
  ['LOG_SYSLOG', '**LOG_SYSLOG** - Messages generated internally by syslogd.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages are generated internally by syslogd.'],
  ['LOG_USER', '**LOG_USER** - Generic user-level messages.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages are generic user-level messages. This is the default facility.'],
  ['LOG_UUCP', '**LOG_UUCP** - UUCP subsystem.\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify that messages relate to the UUCP subsystem.'],
  ['LOG_LOCAL0', '**LOG_LOCAL0** - Local use 0 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 0.'],
  ['LOG_LOCAL1', '**LOG_LOCAL1** - Local use 1 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 1.'],
  ['LOG_LOCAL2', '**LOG_LOCAL2** - Local use 2 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 2.'],
  ['LOG_LOCAL3', '**LOG_LOCAL3** - Local use 3 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 3.'],
  ['LOG_LOCAL4', '**LOG_LOCAL4** - Local use 4 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 4.'],
  ['LOG_LOCAL5', '**LOG_LOCAL5** - Local use 5 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 5.'],
  ['LOG_LOCAL6', '**LOG_LOCAL6** - Local use 6 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 6.'],
  ['LOG_LOCAL7', '**LOG_LOCAL7** - Local use 7 (custom facility).\n\n*Log Facility Constant*\n\nUsed with `openlog()` to specify custom local facility 7.'],

  // Log priorities
  ['LOG_EMERG', '**LOG_EMERG** - System is unusable.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate emergency conditions - system is unusable.'],
  ['LOG_ALERT', '**LOG_ALERT** - Action must be taken immediately.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate alert conditions - action must be taken immediately.'],
  ['LOG_CRIT', '**LOG_CRIT** - Critical conditions.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate critical conditions.'],
  ['LOG_ERR', '**LOG_ERR** - Error conditions.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate error conditions.'],
  ['LOG_WARNING', '**LOG_WARNING** - Warning conditions.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate warning conditions.'],
  ['LOG_NOTICE', '**LOG_NOTICE** - Normal, but significant, condition.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate normal but significant conditions.'],
  ['LOG_INFO', '**LOG_INFO** - Informational message.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate informational messages.'],
  ['LOG_DEBUG', '**LOG_DEBUG** - Debug-level message.\n\n*Log Priority Constant*\n\nUsed with `syslog()` to indicate debug-level messages.'],

  // Ulog channels (OpenWrt specific)
  ['ULOG_KMSG', '**ULOG_KMSG** - Log messages to `/dev/kmsg` (dmesg).\n\n*Ulog Channel Constant (OpenWrt)*\n\nUsed with `ulog_open()` to specify that messages should be logged to `/dev/kmsg`, making them appear in dmesg output.'],
  ['ULOG_SYSLOG', '**ULOG_SYSLOG** - Log messages to syslog.\n\n*Ulog Channel Constant (OpenWrt)*\n\nUsed with `ulog_open()` to specify that messages should be logged using the standard syslog mechanism.'],
  ['ULOG_STDIO', '**ULOG_STDIO** - Log messages to stdout.\n\n*Ulog Channel Constant (OpenWrt)*\n\nUsed with `ulog_open()` to specify that messages should be logged to stdout.']
]);

// Build constants map for the factory (keys used for getConstantNames)
const constantDefs = new Map<string, ConstantDefinition>(
  Array.from(logConstants).map(name => [name, { name, value: 'number', type: 'number', description: '' }])
);

export const logModule: ModuleDefinition = {
  name: 'log',
  functions,
  constants: constantDefs,
  constantDocumentation: logConstantDocs,
  documentation: `## Log Module

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
  importValidation: {
    isValid: (name: string) => functions.has(name) || logConstants.has(name),
    getValidImports: () => [...Array.from(functions.keys()), ...Array.from(logConstants)],
  },
};

// Backwards compatibility
export const logTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isLogFunction: (name: string) => functions.has(name),
  isLogConstant: (name: string) => logConstants.has(name),
  isValidLogImport: (name: string) => functions.has(name) || logConstants.has(name),
  getValidLogImports: () => [...Array.from(functions.keys()), ...Array.from(logConstants)],
  getConstantDocumentation: (name: string) => logConstantDocs.get(name) || '',
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('log', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('log', func);
  },
};
