{% let counter = 1; 'use strict';
	// NON-STRICT. The block leads the file, BUT `let counter = 1;` runs before
	// the directive, so 'use strict' is not the first statement → inert.
	// (Placement is about the first STATEMENT overall, not the first block.)
	//
	// Oracle (all versions): no error; undeclared read is null.
	// LSP: detectStrictMode() == false. (`notdeclared` is still flagged
	//   standalone — undefined-var heuristic; see 05-*.uc.)
	print(notdeclared);
%}
