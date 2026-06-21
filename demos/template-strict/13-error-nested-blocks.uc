{% let outer = 1; {% let inner = 2; %} %}
{#
   SYNTAX ERROR — on purpose. Template blocks may not be nested. Once you are
   inside a `{% … %}` or `{{ … }}` block, an abutting `{%` or `{{` is a nested
   open tag, which ucode rejects outright in the lexer.

   Oracle (all versions 22.03 → main):
     `Syntax error: Template blocks may not be nested`

   The rule is GREEDY on adjacency, matching ucode exactly:
     {% x = {{ c: 3 }}; %}   -> ERROR  (adjacent `{{` is a nested tag)
     {% x = { a: 1 }; %}     -> ok     (a single-brace object literal)
     {% x = { b: { c } }; %} -> ok     (space-separated `{ {` is two braces)
     {% if(x): {% y %} ... %}-> ERROR  (nesting across alt-colon control flow)

   LSP: the lexer now emits "Template blocks may not be nested" here, matching
   ucode. (Accepting a nested block would be a false negative.) #}
