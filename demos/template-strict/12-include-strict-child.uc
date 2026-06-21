{% 'use strict';
	// Strict child, rendered via 11-include-parent.uc which injects { title }.
	//
	// `title` is an injected render-scope global → VALID under strict, not
	//   flagged (the LSP's injected-scope suppression applies in strict too).
	// `subtitle` is NOT injected → a hard Reference error under strict at
	//   runtime, and the LSP flags it (UC1001).
	//
	// Open this file directly and the LSP still knows `title` is injected
	// (cross-file include index); `subtitle` stays flagged.
	printf("title=%s\n", title);
	printf("subtitle=%s\n", subtitle);
%}
