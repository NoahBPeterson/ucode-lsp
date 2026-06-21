{%- 'use strict';
	// Whitespace-TRIM open modifiers do not change directive placement.
	//   {%-  strips preceding whitespace   (open modifier)
	//   {%+  preserves preceding whitespace (open modifier)
	// Both are present in EVERY release (22.03 → main) and both keep the
	// directive first → STRICT. (The earlier "{%+ defeats strict" claim was a
	// test artifact: it used the INVALID close `+%}` — see 09-error-*.uc.)
	//
	// Oracle (all versions): Reference error on `absent` below.
	// LSP: detectStrictMode() == true; `absent` flagged.
-%}
v={{ absent }}
