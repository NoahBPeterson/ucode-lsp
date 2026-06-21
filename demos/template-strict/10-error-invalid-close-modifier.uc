{%+ 'use strict'; +%}
{#
   SYNTAX ERROR — on purpose. `+%}` is NOT a valid close tag in ANY ucode
   release. Only `-` strips on close (`-%}` / `-}}`); `+` is an OPEN-only
   modifier (`{%+` / `{{+`). So `+%}` parses as: end-block-with-no-close, then a
   stray `+` begins a new expression that has no operand.

   Oracle (all versions 22.03 → main):  `Syntax error: Expecting expression`

   THIS is the file that produced the bogus "{%+ defeats strict" finding: an
   earlier probe used `+%}` as the close, the template was actually a syntax
   error, and a checker that only grepped for "undeclared" misread the absence
   of that string as "non-strict". The lesson: a malformed template tells you
   nothing about strict mode. With a valid close (`%}` or `-%}`), `{%+ 'use
   strict';` is STRICT — see 03-strict-trim-modifiers.uc.

   LSP: now REJECTS this too — the lexer no longer accepts `+` as a close
   modifier, so the stray `+` is lexed as an operator and the parser raises
   "Unexpected token in expression" (parallels ucode's "Expecting expression").
   Accepting what ucode rejects is a false negative, so it is not tolerated. #}
x={{ nope }}
