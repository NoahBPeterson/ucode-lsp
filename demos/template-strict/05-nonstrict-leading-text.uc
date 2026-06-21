lead{% 'use strict';
	// NON-STRICT. The literal text "lead" before the block compiles to an
	// implicit print("lead") statement, so 'use strict' is no longer the FIRST
	// statement → the directive is inert (same rule as raw ucode: the directive
	// must be the very first statement).
	//
	// Oracle (all versions): renders "lead" then an empty read — NO error;
	//   an undeclared read is just null in non-strict mode.
	// LSP: detectStrictMode() == false. NOTE: the LSP STILL flags `ghost`
	//   (UC1001) here — standalone there is no in-workspace include() site to
	//   prove it is a render-scope input, so the undefined-var heuristic fires.
	//   The strict/non-strict result does NOT change whether THIS squiggle
	//   appears; it changes runtime semantics (null vs hard Reference error) and
	//   other strict-gated checks. To see `ghost` suppressed, render it through
	//   an include() parent that injects it (see 11/12-*.uc).
	print(ghost);
%}
