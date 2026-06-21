{%
	// Parent (host). It include()s the strict child below, injecting a render
	// scope of { title }. The injected KEYS become the child's globals — valid
	// even under the child's 'use strict'. Run this file (not the child):
	//   ucode -T demos/template-strict/11-include-parent.uc
	//
	// Oracle (all versions): prints "title=Hello" then ERRORS on the child's
	//   read of `subtitle` (not injected) → Reference error in the strict child.
	// LSP: flags `subtitle` at the child, and at THIS include site reports that
	//   the scope fails to provide `subtitle` (checkIncludeScopes host finding).
	include("12-include-strict-child.uc", { title: "Hello" });
%}
