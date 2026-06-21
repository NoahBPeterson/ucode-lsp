
   {% 'use strict';
	// NON-STRICT — and this one is SUBTLE. The blank line + spaces BEFORE the
	// `{%` block are literal template text, so they compile to a print() of that
	// whitespace. That print() is the first statement, so 'use strict' is inert.
	//
	// i.e. leading whitespace silently defeats strict mode in a template. The
	// LSP mirrors this: detectStrictMode() requires the source to start (after a
	// shebang only) DIRECTLY with `{%` — leading whitespace counts as text.
	//
	// Oracle (all versions): no error; undeclared read is null.
	// LSP: detectStrictMode() == false. (`invisible` is still flagged standalone
	//   — undefined-var heuristic; see 05-*.uc.)
	print(invisible);
%}
