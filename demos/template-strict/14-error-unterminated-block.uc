{# Unterminated EXPRESSION block demo (on purpose). An expression block (or a
   comment block) that reaches end-of-file without its close tag is an error:

     Oracle (all versions 22.03 to main): Syntax error: Unterminated template block

   Asymmetry, matching ucode exactly (lexer.c errors at EOF unless block is a
   STATEMENT block): a statement block MAY run to EOF unterminated, but an
   expression block may not. The last line below opens an expression block and
   never closes it, so it errors. #}
output value = {{ 1 + 2
