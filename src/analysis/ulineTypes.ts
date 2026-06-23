/**
 * uline module type definitions (ucode-mod-uline) — interactive line editing.
 *
 * This is the editline-style module the OpenWrt `cli` framework builds on
 * (`import * as uline from "uline"` in /usr/sbin/cli). Names are authoritative —
 * module functions, handle method names, and resource type names come from the
 * vendored source's uc_function_list_t / uc_type_declare tables
 * (openwrt/package/utils/ucode-mod-uline/src/ucode.c):
 *   global_fns: new arg_parser getpass
 *   new()        → ucv_resource_new(state_type)  → "uline.state"
 *   arg_parser() → ucv_resource_new(argp_type)   → "uline.argp"
 *   getpass()    → string | null
 *   state_fns: close poll poll_stop poll_key reset_key_input get_line get_window
 *              set_hint set_state set_uloop hide_prompt refresh_prompt
 *   argp_fns:  parse check escape
 *
 * Parameter types are permissive (the source carries no jsdoc); a few obvious
 * return types are typed (get_line → string|null, getpass → string|null).
 * First available on OpenWrt 25.12 (feed package `ucode-mod-uline`).
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ObjectTypeDefinition } from './registryFactory';

const ANY = (n: string, optional = false) => ({ name: n, type: 'any', optional });
const fn = (name: string, parameters: FunctionSignature['parameters'], returnType: string, description: string): [string, FunctionSignature] =>
  [name, { name, parameters, returnType, description }];

const functions = new Map<string, FunctionSignature>([
  fn('new', [ANY('options', true)], 'uline.state | null', 'Create a new interactive line-editing session and return a handle, or null on failure.'),
  fn('arg_parser', [ANY('options', true)], 'uline.argp | null', 'Create an argument parser/tokenizer handle, or null on failure.'),
  fn('getpass', [ANY('prompt', true)], 'string | null', 'Prompt for a password on the controlling terminal without echo. Returns the entered string, or null.'),
]);

export { functions as ulineFunctions };

export const ulineStateObjectType: ObjectTypeDefinition = {
  typeName: 'uline.state',
  methods: new Map<string, FunctionSignature>([
    fn('get_line', [], 'string | null', 'Return the current line buffer contents.'),
    fn('get_window', [], 'object | null', 'Return the current terminal window size (rows/cols).'),
    fn('poll', [ANY('timeout', true)], 'any', 'Poll for input/events on the session.'),
    fn('poll_key', [ANY('timeout', true)], 'any', 'Poll for a single key press.'),
    fn('poll_stop', [], 'any', 'Stop an in-progress poll.'),
    fn('reset_key_input', [], 'any', 'Reset pending key-input state.'),
    fn('set_hint', [ANY('hint', true)], 'any', 'Set the inline hint text shown after the cursor.'),
    fn('set_state', [ANY('state')], 'any', 'Set session state (e.g. prompt/line/cursor).'),
    fn('set_uloop', [ANY('enable', true)], 'any', 'Integrate the session with the uloop event loop.'),
    fn('hide_prompt', [], 'any', 'Temporarily hide the prompt (e.g. to print output).'),
    fn('refresh_prompt', [], 'any', 'Redraw the prompt and current line.'),
    fn('close', [], 'any', 'Close the line-editing session and restore the terminal.'),
  ]),
};

export const ulineArgpObjectType: ObjectTypeDefinition = {
  typeName: 'uline.argp',
  methods: new Map<string, FunctionSignature>([
    fn('parse', [ANY('input')], 'any', 'Parse an input string into an array of arguments/tokens.'),
    fn('check', [ANY('input')], 'any', 'Validate that an input string tokenizes cleanly (e.g. balanced quotes).'),
    fn('escape', [ANY('value')], 'any', 'Escape a value so it survives a round trip through parse().'),
  ]),
};

export const ulineModule: ModuleDefinition = {
  name: 'uline',
  functions,
  documentation: `## uline Module

Interactive line editing for ucode CLIs (\`ucode-mod-uline\`) — the basis of the
OpenWrt \`cli\` framework's interactive shell.

\`\`\`ucode
import * as uline from 'uline';
let el = uline.new({ prompt: '> ' });
let key = el.poll_key(1000);
el.hide_prompt();
\`\`\`

First available on OpenWrt **25.12** (feed package \`ucode-mod-uline\`).

**Functions:** new → uline.state, arg_parser → uline.argp, getpass → string
**Handles:** uline.state (line session), uline.argp (argument parser)`,
  importValidation: {
    isValid: (name: string) => functions.has(name),
    getValidImports: () => Array.from(functions.keys()),
  },
};
