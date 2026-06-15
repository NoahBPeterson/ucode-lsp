// #24 — nl80211/rtnl constants are NOT top-level exports. They live under the module's nested
// `const` object (lib/{nl80211,rtnl}.c: ADD_CONST targets scope.const, not scope), so the only
// way to reach them is `nl80211.const.X`. Importing a bare constant is invalid.
//
// Open in the editor; expectations noted per line.

// ── invalid: bare constants are NOT importable -> UC3005 "not exported" ──
import { NLM_F_ACK } from 'nl80211';   // UC3005 on NLM_F_ACK: not exported by nl80211
import { RTM_NEWLINK } from 'rtnl';    // UC3005 on RTM_NEWLINK: not exported by rtnl

// ── valid: the real top-level exports import cleanly ──
import { request, waitfor, listener, error } from 'nl80211';   // clean
import { request as rtreq, listener as rtlsn } from 'rtnl';    // clean

// ── the correct way to reach constants: via the `const` namespace ──
import * as nl from 'nl80211';
let cmd = nl.const.NL80211_CMD_GET_WIPHY;   // clean — completion lists all constants after `nl.const.`

// ── contrast: socket constants ARE genuinely top-level (lib/socket.c ADD_CONST -> scope) ──
import { AF_INET } from 'socket';   // clean (correct — socket really does export these)

// In the editor, trigger completion inside the braces of:  import {  } from 'nl80211';
//   -> offers error, request, waitfor, listener, const  (NOT the ~155 NL80211_*/NLM_* constants)

let cmd = nl.const.   // clean — completion lists all constants after `nl.const.`
let cmd = nl.const.HWSIM_CMD_ABORT_PMSR;   // clean — completion lists all constants after `nl.const.`