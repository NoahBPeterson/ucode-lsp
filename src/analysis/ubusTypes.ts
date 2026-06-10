/**
 * ubus module type definitions and function signatures
 * Based on ucode/lib/ubus.c global_fns[]
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition, ObjectTypeDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

// Methods of the connection object returned by ubus.connect() / open_channel().
// Mirrors ucode/lib/ubus.c conn_fns[].
const connectionMethods = new Map<string, FunctionSignature>([
  ['call', {
    name: 'call',
    parameters: [
      { name: 'object', type: 'string', optional: false },
      { name: 'method', type: 'string', optional: false },
      { name: 'data', type: 'object', optional: true },
      { name: 'return_mode', type: 'string', optional: true },
      { name: 'fd', type: 'integer', optional: true },
      { name: 'fd_cb', type: 'function', optional: true },
    ],
    returnType: 'object | null',
    description: 'Invoke a method on a ubus object and return its reply, or null on error (e.g. object/method not found).',
  }],
  ['list', {
    name: 'list',
    parameters: [
      { name: 'object', type: 'string', optional: true },
    ],
    returnType: 'array | object | null',
    description: "Without an argument, list all registered ubus object names (array). With an object name, return that object's method signatures. null on error.",
  }],
  ['defer', {
    name: 'defer',
    parameters: [
      { name: 'object', type: 'string', optional: false },
      { name: 'method', type: 'string', optional: false },
      { name: 'data', type: 'object', optional: true },
      { name: 'cb', type: 'function', optional: true },
    ],
    returnType: 'ubus.deferred | null',
    description: 'Start an asynchronous ubus request, returning a deferred-request handle (resolved later via the callback), or null on error.',
  }],
  ['publish', {
    name: 'publish',
    parameters: [
      { name: 'object', type: 'string', optional: false },
      { name: 'methods', type: 'object', optional: true },
      { name: 'subscribe_cb', type: 'function', optional: true },
    ],
    returnType: 'ubus.object | null',
    description: 'Register (publish) a ubus object with the given methods so other clients can call it. Returns the published-object handle, or null on error.',
  }],
  ['remove', {
    name: 'remove',
    parameters: [
      { name: 'object', type: 'object', optional: false },
    ],
    returnType: 'boolean | null',
    description: 'Unregister a previously published object, listener, or subscriber. Returns true on success, null on error.',
  }],
  ['listener', {
    name: 'listener',
    parameters: [
      { name: 'pattern', type: 'string', optional: false },
      { name: 'cb', type: 'function', optional: false },
    ],
    returnType: 'ubus.listener | null',
    description: 'Register an event listener for the given event-name pattern. Returns a listener handle, or null on error.',
  }],
  ['subscriber', {
    name: 'subscriber',
    parameters: [
      { name: 'notify_cb', type: 'function', optional: true },
      { name: 'remove_cb', type: 'function', optional: true },
      { name: 'patterns', type: 'array', optional: true },
    ],
    returnType: 'ubus.subscriber | null',
    description: 'Create a ubus subscriber that receives notifications from objects it subscribes to. Returns a subscriber handle, or null on error.',
  }],
  ['event', {
    name: 'event',
    parameters: [
      { name: 'id', type: 'string', optional: false },
      { name: 'data', type: 'object', optional: true },
    ],
    returnType: 'boolean | null',
    description: 'Broadcast a ubus event with the given id and optional data. Returns true on success, null on error.',
  }],
  ['error', {
    name: 'error',
    parameters: [
      { name: 'numeric', type: 'boolean', optional: true },
    ],
    returnType: 'integer | string | null',
    description: 'Return the last error on this connection — the numeric code when `numeric` is true, otherwise a message string. null if there was no error.',
  }],
  ['disconnect', {
    name: 'disconnect',
    parameters: [],
    returnType: 'boolean | null',
    description: 'Close the ubus connection. Returns true on success, null on error.',
  }],
]);

/** The connection object returned by ubus.connect(). */
export const ubusConnectionObjectType: ObjectTypeDefinition = {
  typeName: 'ubus.connection',
  methods: connectionMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**ubus.connection.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

// Helper to build an ObjectTypeDefinition for a ubus handle.
const ubusObjectType = (typeName: string, methods: Map<string, FunctionSignature>): ObjectTypeDefinition => ({
  typeName,
  methods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**${typeName}.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
});

// ── Secondary handles (returned by connection/channel/object/request methods) ──
// All mirror ucode/lib/ubus.c *_fns[].

// chan_fns — the channel from ubus.open_channel().
export const ubusChannelObjectType = ubusObjectType('ubus.channel', new Map<string, FunctionSignature>([
  ['request', { name: 'request', parameters: [
      { name: 'method', type: 'string', optional: false },
      { name: 'data', type: 'object', optional: true },
      { name: 'return_mode', type: 'string', optional: true },
      { name: 'fd', type: 'integer', optional: true },
      { name: 'fd_cb', type: 'function', optional: true },
    ], returnType: 'ubus.request | null', description: 'Issue a request on the channel, returning a request handle, or null on error.' }],
  ['defer', { name: 'defer', parameters: [
      { name: 'method', type: 'string', optional: false },
      { name: 'data', type: 'object', optional: true },
      { name: 'cb', type: 'function', optional: true },
    ], returnType: 'ubus.deferred | null', description: 'Issue an asynchronous request on the channel, returning a deferred-request handle, or null on error.' }],
  ['error', { name: 'error', parameters: [{ name: 'numeric', type: 'boolean', optional: true }], returnType: 'integer | string | null', description: 'Return the last channel error, or null if none.' }],
  ['disconnect', { name: 'disconnect', parameters: [], returnType: 'boolean | null', description: 'Close the channel. Returns true on success, null on error.' }],
]));

// defer_fns — a pending asynchronous request (from conn/channel.defer()).
export const ubusDeferredObjectType = ubusObjectType('ubus.deferred', new Map<string, FunctionSignature>([
  ['await', { name: 'await', parameters: [{ name: 'timeout', type: 'integer', optional: true }], returnType: 'object | null', description: 'Block until the deferred request completes and return its reply, or null on error/timeout.' }],
  ['completed', { name: 'completed', parameters: [], returnType: 'boolean', description: 'Return whether the deferred request has finished.' }],
  ['abort', { name: 'abort', parameters: [], returnType: 'boolean', description: 'Cancel the pending request. Returns true if it was aborted.' }],
]));

// object_fns — a published object (from conn.publish()).
export const ubusObjectObjectType = ubusObjectType('ubus.object', new Map<string, FunctionSignature>([
  ['subscribed', { name: 'subscribed', parameters: [], returnType: 'boolean', description: 'Return whether any client is currently subscribed to this object.' }],
  ['notify', { name: 'notify', parameters: [
      { name: 'type', type: 'string', optional: false },
      { name: 'data', type: 'object', optional: true },
      { name: 'data_cb', type: 'function', optional: true },
      { name: 'status_cb', type: 'function', optional: true },
    ], returnType: 'ubus.notify | null', description: 'Send a notification to subscribers, returning a notify handle, or null on error.' }],
  ['remove', { name: 'remove', parameters: [], returnType: 'boolean | null', description: 'Unregister the published object. Returns true on success, null on error.' }],
]));

// request_fns — a server-side request handle.
export const ubusRequestObjectType = ubusObjectType('ubus.request', new Map<string, FunctionSignature>([
  ['reply', { name: 'reply', parameters: [
      { name: 'reply', type: 'object', optional: true },
      { name: 'rcode', type: 'integer', optional: true },
    ], returnType: 'boolean | null', description: 'Send a reply (and optional status code) for the request. Returns true on success, null on error.' }],
  ['error', { name: 'error', parameters: [{ name: 'rcode', type: 'integer', optional: false }], returnType: 'boolean | null', description: 'Complete the request with an error status code.' }],
  ['defer', { name: 'defer', parameters: [], returnType: 'boolean | null', description: 'Defer the reply, keeping the request open to answer later.' }],
  ['get_fd', { name: 'get_fd', parameters: [], returnType: 'integer | null', description: 'Return a file descriptor attached to the request, or null if none.' }],
  ['set_fd', { name: 'set_fd', parameters: [{ name: 'fd', type: 'integer', optional: false }], returnType: 'boolean | null', description: 'Attach a file descriptor to the reply.' }],
  ['new_channel', { name: 'new_channel', parameters: [{ name: 'timeout', type: 'integer', optional: true }], returnType: 'ubus.channel | null', description: 'Convert the request into a bidirectional channel, returning the channel handle, or null on error.' }],
]));

// notify_fns — an in-flight notification (from object.notify()).
export const ubusNotifyObjectType = ubusObjectType('ubus.notify', new Map<string, FunctionSignature>([
  ['completed', { name: 'completed', parameters: [], returnType: 'boolean', description: 'Return whether all subscribers have acknowledged the notification.' }],
  ['abort', { name: 'abort', parameters: [], returnType: 'boolean', description: 'Cancel the pending notification.' }],
]));

// listener_fns — an event listener (from conn.listener()).
export const ubusListenerObjectType = ubusObjectType('ubus.listener', new Map<string, FunctionSignature>([
  ['remove', { name: 'remove', parameters: [], returnType: 'boolean | null', description: 'Stop and remove the event listener. Returns true on success, null on error.' }],
]));

// subscriber_fns — a subscriber (from conn.subscriber()).
export const ubusSubscriberObjectType = ubusObjectType('ubus.subscriber', new Map<string, FunctionSignature>([
  ['subscribe', { name: 'subscribe', parameters: [{ name: 'path', type: 'string', optional: false }], returnType: 'boolean | null', description: 'Subscribe to notifications from the named object path. Returns true on success, null on error.' }],
  ['unsubscribe', { name: 'unsubscribe', parameters: [{ name: 'path', type: 'string', optional: false }], returnType: 'boolean | null', description: 'Stop receiving notifications from the named object path.' }],
  ['remove', { name: 'remove', parameters: [], returnType: 'boolean | null', description: 'Tear down the subscriber. Returns true on success, null on error.' }],
]));

// The C global_fns list (ubus.c) — registered into the module scope.
const globalFunctions = new Map<string, FunctionSignature>([
  ["error", {
    name: "error",
    parameters: [
      { name: "numeric", type: "boolean", optional: true }
    ],
    returnType: "integer | string | null",
    description: "Retrieve the last ubus error. Returns error code as integer if numeric is true, otherwise returns formatted error message as string. Returns null if no error occurred."
  }],
  ["connect", {
    name: "connect",
    parameters: [
      { name: "socket", type: "string", optional: true },
      { name: "timeout", type: "integer", optional: true, defaultValue: 30 }
    ],
    returnType: "ubus.connection | null",
    description: "Establish a connection to the ubus daemon. Returns a connection object that can be used for further ubus operations, or null on connection failure."
  }],
  ["open_channel", {
    name: "open_channel",
    parameters: [
      { name: "fd", type: "integer", optional: false },
      { name: "cb", type: "function", optional: true },
      { name: "disconnect_cb", type: "function", optional: true },
      { name: "timeout", type: "integer", optional: true, defaultValue: 30 }
    ],
    returnType: "ubus.channel | null",
    description: `Create a ubus channel connection using an existing file descriptor. Used for bidirectional communication over established connections.

**Example:**
\`\`\`ucode
import { open_channel } from 'ubus';

let chan = open_channel(fd, function(msg) {
    printf("Received: %J\\n", msg);
});
\`\`\``
  }],
  ["guard", {
    name: "guard",
    parameters: [
      { name: "handler", type: "function", optional: true }
    ],
    returnType: "function | boolean | null",
    description: "Set or get the global ubus exception handler. If called without arguments, returns current handler. If called with a handler function, sets it as the exception handler."
  }]
]);

// ubus.c `uc_module_init()` registers BOTH function lists into the module scope:
//   uc_function_list_register(scope, global_fns);   // error, connect, open_channel, guard
//   uc_function_list_register(scope, conn_fns);      // list, call, defer, publish, remove,
//                                                    // listener, subscriber, event, …
// So the connection functions are valid members of the `ubus` module namespace too, not
// only of a connection object — `ubus.call(...)`, `ubus.publish(...)`, `ubus.listener(...)`
// are real (29 occurrences in the OpenWrt corpus). Model the module's member set as the
// union (the module-level `error` description wins for the namespace).
const functions = new Map<string, FunctionSignature>([
  ...connectionMethods,
  ...globalFunctions,
]);

// Backwards-compat exports
export { functions as ubusFunctions };
export type UbusFunctionSignature = FunctionSignature;
export type UbusConstantSignature = ConstantDefinition;

export const ubusConstants: Map<string, ConstantDefinition> = new Map([
  ["STATUS_OK", {
    name: "STATUS_OK",
    value: 0,
    type: "integer",
    description: "Operation completed successfully"
  }],
  ["STATUS_INVALID_COMMAND", {
    name: "STATUS_INVALID_COMMAND",
    value: 1,
    type: "integer",
    description: "Invalid or unknown command"
  }],
  ["STATUS_INVALID_ARGUMENT", {
    name: "STATUS_INVALID_ARGUMENT",
    value: 2,
    type: "integer",
    description: "Invalid argument provided to function"
  }],
  ["STATUS_METHOD_NOT_FOUND", {
    name: "STATUS_METHOD_NOT_FOUND",
    value: 3,
    type: "integer",
    description: "Requested method not found on object"
  }],
  ["STATUS_NOT_FOUND", {
    name: "STATUS_NOT_FOUND",
    value: 4,
    type: "integer",
    description: "Requested object or resource not found"
  }],
  ["STATUS_NO_DATA", {
    name: "STATUS_NO_DATA",
    value: 5,
    type: "integer",
    description: "No data available or returned"
  }],
  ["STATUS_PERMISSION_DENIED", {
    name: "STATUS_PERMISSION_DENIED",
    value: 6,
    type: "integer",
    description: "Access denied due to insufficient permissions"
  }],
  ["STATUS_TIMEOUT", {
    name: "STATUS_TIMEOUT",
    value: 7,
    type: "integer",
    description: "Operation timed out"
  }],
  ["STATUS_NOT_SUPPORTED", {
    name: "STATUS_NOT_SUPPORTED",
    value: 8,
    type: "integer",
    description: "Operation or feature not supported"
  }],
  ["STATUS_UNKNOWN_ERROR", {
    name: "STATUS_UNKNOWN_ERROR",
    value: 9,
    type: "integer",
    description: "Unknown or unspecified error occurred"
  }],
  ["STATUS_CONNECTION_FAILED", {
    name: "STATUS_CONNECTION_FAILED",
    value: 10,
    type: "integer",
    description: "Failed to establish connection"
  }],
  ["STATUS_NO_MEMORY", {
    name: "STATUS_NO_MEMORY",
    value: 11,
    type: "integer",
    description: "Insufficient memory available"
  }],
  ["STATUS_PARSE_ERROR", {
    name: "STATUS_PARSE_ERROR",
    value: 12,
    type: "integer",
    description: "Error parsing data or message"
  }],
  ["STATUS_SYSTEM_ERROR", {
    name: "STATUS_SYSTEM_ERROR",
    value: 13,
    type: "integer",
    description: "System-level error occurred"
  }],
  ["STATUS_CONTINUE", {
    name: "STATUS_CONTINUE",
    value: -1,
    type: "integer",
    description: "Virtual status code for continuing multi-part replies"
  }],
  ["SYSTEM_OBJECT_ACL", {
    name: "SYSTEM_OBJECT_ACL",
    value: 1,
    type: "integer",
    description: "System object access control list identifier"
  }]
]);

export const ubusModule: ModuleDefinition = {
  name: 'ubus',
  functions,
  constants: ubusConstants,
  documentation: `## ubus Module

**OpenWrt unified bus communication for ucode scripts**

The ubus module provides comprehensive access to the OpenWrt unified bus (ubus) system, enabling communication with system services and daemons.

### Usage

**Named import syntax:**
\`\`\`ucode
import { connect, error } from 'ubus';

let conn = connect();
let result = conn.call('system', 'info');
if (!result) {
    print('ubus error: ', error(), '\\n');
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as ubus from 'ubus';

let conn = ubus.connect();
let result = conn.call('system', 'info');
\`\`\`

### Available Functions

- **\`error()\`** - Retrieve the last ubus error
- **\`connect()\`** - Establish connection to ubus daemon
- **\`open_channel()\`** - Create ubus channel from file descriptor
- **\`guard()\`** - Set/get global ubus exception handler

### Status Constants

STATUS_OK, STATUS_INVALID_COMMAND, STATUS_INVALID_ARGUMENT, STATUS_METHOD_NOT_FOUND, STATUS_NOT_FOUND, STATUS_NO_DATA, STATUS_PERMISSION_DENIED, STATUS_TIMEOUT, STATUS_NOT_SUPPORTED, STATUS_UNKNOWN_ERROR, STATUS_CONNECTION_FAILED, STATUS_NO_MEMORY, STATUS_PARSE_ERROR, STATUS_SYSTEM_ERROR, STATUS_CONTINUE

*Hover over individual function names for detailed parameter and return type information.*`,
};

// Backwards compatibility
export const ubusTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isUbusFunction: (name: string) => functions.has(name),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('ubus', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('ubus', func);
  },
  getConstantNames: () => Array.from(ubusConstants.keys()),
  getConstant: (name: string) => ubusConstants.get(name),
  isUbusConstant: (name: string) => ubusConstants.has(name),
  getConstantDocumentation: (name: string) => {
    const constant = ubusConstants.get(name);
    if (!constant) return '';
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  },
  isValidImport: (name: string) => functions.has(name) || ubusConstants.has(name),
  getValidImports: () => [...Array.from(functions.keys()), ...Array.from(ubusConstants.keys())],
};
