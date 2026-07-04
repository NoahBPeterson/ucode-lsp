# UC7003 "add @param" on object-literal property functions — FIXED 0.7.58

Status: **IMPLEMENTED 0.7.58.** The `@param` hint + its quick-fix now fire on function
values of object-literal properties (the RPC-handler idiom `export default { method:
function(args, ctx){…} }`), not only top-level declarations and `x = function(){}`.

## Root cause + fix

UC7003 is emitted by `emitMissingParamAnnotations`, gated on a *display name*
(`exprName`) for the function. `exprName` comes from `pendingFunctionExprName`, which was
set only in the assignment path (`X = function` → `assignmentTargetName`). Object
properties (`key: function`) never set it, so a property function had no name → no hint.

Fix: `visitProperty` now sets `pendingFunctionExprName` to the (non-computed) property key
before visiting a function/arrow value. The quick-fix (`generateJsDocQuickFix`) already
accepted a `Property` value as an attachable JSDoc site, so wiring the diagnostic was
enough. The parser already propagates a property's leading JSDoc onto its function value
(compositeExpressions.ts), so adding JSDoc clears the hint. Strict-mode gated, Information
severity — consistent with function declarations. Tests: tests/diagnostics/
test-jsdoc-property-function.test.js.

---

## Original investigation sample (gl-ucode `rpc/ui`)

```ucode
// gl-ucode object: ui  (port of decompiled-spec/rpc/ui.lua)
// The app hits ui.check_initialized / ui.get_lang first (both no-auth), then
// either ui.init (onboarding) or the login flow.
'use strict';

const fs = require('fs');

const LOCALES_PATH = "/www/i18n";
const MENU_PATH    = "/www/menus";

/**
 * @param {string} p
 */
function readfile(p) { let d = fs.readfile(p); return d ? d : null; } // (variable) d: string | null // second `d`: (variable) d: string // `readfile`: Returns: unknown | null

export default {
	check_initialized: function(args, ctx) {
		let c = ctx.uci.cursor();
		let inited = (c.get("oui-httpd", "main", "inited") == "1");
		let model = (function() { let d = fs.readfile("/proc/gl-hw-info/model");
			return d ? trim(d) : (c.get("board_special", "hardware", "model") ?? "sft1200"); })();
		let fwcat = (function() { let d = fs.readfile("/etc/firmware_type"); return d ? trim(d) : "2c"; })();
		return {
			initialized: inited,
			model: model,
			firmware_category: fwcat,
			support_online_upgrade: false,
			support_screen_init: false,
			environment_support: false
		};
	},

	get_lang: function(args, ctx) {
		let seen = {}, list = [];
		let dir = fs.access(LOCALES_PATH) ? fs.lsdir(LOCALES_PATH) : null; // (variable) dir: unknown | null // `lsdir`: Returns: array<string> | null 
		for (let name in (dir ?? [])) {
			let m = match(name, /\.([a-zA-Z-]+)\.json$/);
			if (m && !seen[m[1]]) {
				seen[m[1]] = true;
				push(list, { value: m[1], label: m[1], id: length(list) + 1 });
			}
		}
		if (length(list) == 0)
			list = [ { value: "en", label: "English", id: 1 } ];
		let c = ctx.uci.cursor();
		return { lang_list: list, langs: list, lang: c.get("oui-httpd", "main", "lang") ?? "en" };
	},

	load_locales: function(args, ctx) { // no jsdoc information diagnostic or quick fix?
    		// lang feeds a regex below, so constrain it (avoid regex-injection)
		let lang = (args && args.lang && match(args.lang, /^[a-zA-Z-]+$/)) ? args.lang : "en";
		let merged = {};
		let dir = fs.access(LOCALES_PATH) ? fs.lsdir(LOCALES_PATH) : null;
		let re = regexp(`\\.${lang}\\.json$`);   // ucode match() needs a regex, not a string
		for (let name in (dir ?? [])) {
			if (!match(name, re)) continue;
			let raw = readfile(`${LOCALES_PATH}/${name}`);
			if (!raw) continue;
			let obj;
			try { obj = json(raw); } catch (e) { continue; }
			for (let k in obj) merged[k] = obj[k];
		}
		return merged;
	},
// cut off here, but not needed for reproduction of issue
```