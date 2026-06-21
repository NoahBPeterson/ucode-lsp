{{ 1 }}{% 'use strict';
	// NON-STRICT. A leading expression tag `{{ 1 }}` compiles to print(1) — a
	// statement — so the following 'use strict' is not first and is inert.
	//
	// Oracle (all versions): renders "1" then null — NO error.
	// LSP: detectStrictMode() == false. (`phantom` is still flagged standalone —
	//   undefined-var heuristic; see 05-*.uc for the full explanation.)
	print(phantom);
%}
