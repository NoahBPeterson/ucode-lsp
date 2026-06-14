// Completion cluster (#19/#20/#23/#96). Open in the editor and trigger completion (type the
// trailing `.`, or Ctrl+Space) at the marked spots — expectations noted per line.

// ── #19 nested object members at any depth (was: offered the parent key / nothing) ──
let cfg = { net: { wan: { proto: "dhcp", mtu: 1500 }, lan: { ip: "10.0.0.1" } } };
// cfg.net.        →  [wan, lan]
// cfg.net.wan.    →  [proto, mtu]
let w = cfg.net.wan;
// w.              →  [proto, mtu]   (alias resolves through the member chain)

// ── #20 optional chaining is a member-access trigger (was: 91 global builtins) ──
let opt = { host: "h", port: 80 };
// opt?.           →  [host, port]   (exactly like opt.)

// ── #23 nl80211 / rtnl constants live under `const` — their only access path ──
import * as nl from 'nl80211';
// nl.const.       →  NL80211_CMD_*, NL80211_IFTYPE_*, NLM_F_*, …  (was: 0 items)
import * as rt from 'rtnl';
// rt.const.       →  RTM_NEWLINK, RTNL_FAMILY_*, …                (was: 0 items)

// ── #96 module-path completion for the named-import form (was: 91 builtins) ──
import { open } from 'fs';
//                  ^ put the cursor inside the 'fs' string → fs, math, uci, ubus, … (Module items)
