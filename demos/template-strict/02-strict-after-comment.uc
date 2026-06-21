{# A comment block emits NO statement, so a directive immediately after it is
   still the first statement. TWO subtleties this file depends on:
   (1) ucode comments do NOT nest -- the first close sequence ends the comment,
       so never write a nested open marker in the body.
   (2) the comment close must ABUT the block: any text (even a newline) between
       them compiles to a print() and defeats the directive. So it is
       `...close-here%}{open-here% 'use strict';` with nothing in between. #}{% 'use strict';
	// Oracle (all versions): Reference error on the undeclared read below.
	// LSP: detectStrictMode() == true; `missing` is flagged (UC1001).
%}
out={{ missing }}
