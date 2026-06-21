{% //'use strict';
	// STRICT. The `{% 'use strict'; %}` block is the FIRST thing in the file,
	// so the directive is the first statement and is honored.
	//
	// Oracle (ucode -T, identical 22.03/23.05/24.10/25.12/main):
	//   `Reference error: access to undeclared variable nope`
	//
	// LSP: detectStrictMode() == true, and the undeclared read below is flagged
	//      (UC1001) — matching the hard runtime error.
	let greeting = "hi";
	print(greeting);
	print(`${1+2}`)
%}
//value={{ nope }} # Appears to be commented out, but in ucode template files, this actually prints utpl ./demos/template-strict/01-strict-leading-block.uc