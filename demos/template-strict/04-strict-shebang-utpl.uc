#!/usr/bin/utpl
{% 'use strict';
	// A shebang is not a statement, so the directly-following {% block is still
	// first → STRICT. The `utpl` shebang ALSO selects template mode for the LSP
	// (mode is invocation-determined; `utpl` / `ucode -T` == template).
	//
	// Oracle (all versions): Reference error on `unset` below.
	// LSP: detectTemplateMode() == true (shebang), detectStrictMode() == true.
%}
result={{ unset }}
