{% 'use strcit';
	// NON-STRICT. "use strcit" (typo) is just a string-expression statement, not
	// the recognized directive, so strict mode is never enabled. Same for wrong
	// case ('USE STRICT'), extra words ('use strict mode'), or concatenation
	// ('use ' + 'strict') — only the exact literal 'use strict' counts.
	//
	// Oracle (all versions): no error; undeclared read is null.
	// LSP: detectStrictMode() == false. (`typoland` is still flagged standalone —
	//   undefined-var heuristic; see 05-*.uc.)
	print(typoland);
%}
