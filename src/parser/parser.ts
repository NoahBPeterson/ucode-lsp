/**
 * ucode AST Parser
 * Recursive descent parser with Pratt parsing for expressions
 * Includes comprehensive error recovery mechanisms
 */

import { Token, TokenType } from '../lexer';
import { 
  AstNode, ProgramNode, LiteralNode, IdentifierNode, BinaryExpressionNode,
  UnaryExpressionNode, CallExpressionNode, MemberExpressionNode,
  ArrayExpressionNode, ObjectExpressionNode, PropertyNode,
  BlockStatementNode, ExpressionStatementNode, VariableDeclarationNode,
  VariableDeclaratorNode, IfStatementNode, ForStatementNode, WhileStatementNode,
  FunctionDeclarationNode, ReturnStatementNode, BreakStatementNode,
  ContinueStatementNode, AssignmentExpressionNode, ConditionalExpressionNode,
  ThisExpressionNode, TryStatementNode, CatchClauseNode,
  SwitchStatementNode, SwitchCaseNode, DeleteExpressionNode,
  EmptyStatementNode, ForInStatementNode
} from '../ast/nodes';
import { 
  ParseResult, ParseError, ParseWarning, Precedence, ParseRule,
  RecoveryMode, STATEMENT_SYNC_TOKENS,
  EXPRESSION_SYNC_TOKENS
} from './types';

export class UcodeParser {
  private tokens: Token[];
  private current: number = 0;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];
  private rules: Map<TokenType, ParseRule> = new Map();
  private panicMode = false;
  private sourceCode: string;

  constructor(tokens: Token[], sourceCode: string = '') {
    this.tokens = tokens;
    this.sourceCode = sourceCode;
    this.initializeParseRules();
  }

  parse(): ParseResult {
    try {
      const ast = this.parseProgram();
      return { 
        ast, 
        errors: this.errors, 
        warnings: this.warnings 
      };
    } catch (error) {
      // Catastrophic error - return partial result
      return { 
        ast: null, 
        errors: this.errors, 
        warnings: this.warnings 
      };
    }
  }

  // ========== MAIN PARSING METHODS ==========

  private parseProgram(): ProgramNode {
    const start = this.peek()?.pos || 0;
    const body: AstNode[] = [];

    while (!this.isAtEnd()) {
      try {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      } catch (error) {
        // Error recovery at statement level
        this.synchronize(RecoveryMode.STATEMENT);
        if (this.isAtEnd()) break;
      }
    }

    return {
      type: 'Program',
      start,
      end: this.previous()?.end || start,
      body
    };
  }

  private parseStatement(): AstNode | null {
    // Skip comments and handle error tokens
    if (this.match(TokenType.TK_COMMENT)) {
      return null; // Skip comments
    }

    if (this.check(TokenType.TK_ERROR)) {
      const errorToken = this.advance()!;
      // Use the error message from the token if available
      const message = errorToken.value ? String(errorToken.value) : "Unexpected token";
      this.errorAt(message, errorToken.pos, errorToken.end);
      return null;
    }

    try {
      // Variable declarations
      if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        return this.parseVariableDeclaration();
      }

      // Function declarations
      if (this.match(TokenType.TK_FUNC)) {
        return this.parseFunctionDeclaration();
      }

      // Control flow statements
      if (this.match(TokenType.TK_IF)) {
        return this.parseIfStatement();
      }

      if (this.match(TokenType.TK_WHILE)) {
        return this.parseWhileStatement();
      }

      if (this.match(TokenType.TK_FOR)) {
        return this.parseForStatement();
      }

      if (this.match(TokenType.TK_RETURN)) {
        return this.parseReturnStatement();
      }

      if (this.match(TokenType.TK_BREAK)) {
        return this.parseBreakStatement();
      }

      if (this.match(TokenType.TK_CONTINUE)) {
        return this.parseContinueStatement();
      }

      if (this.match(TokenType.TK_TRY)) {
        return this.parseTryStatement();
      }

      // Note: ucode doesn't have throw statements

      if (this.match(TokenType.TK_SWITCH)) {
        return this.parseSwitchStatement();
      }

      // Block statements
      if (this.match(TokenType.TK_LBRACE)) {
        const openingBrace = this.previous()!; // We just consumed it with match()
        return this.parseBlockStatement(openingBrace, "block statement");
      }

      // Empty statements
      if (this.match(TokenType.TK_SCOL)) {
        return this.parseEmptyStatement();
      }

      // Expression statements (default)
      return this.parseExpressionStatement();

    } catch (error) {
      // Statement-level error recovery
      this.synchronize(RecoveryMode.STATEMENT);
      return null;
    }
  }

  private parseExpression(precedence: Precedence = Precedence.ASSIGNMENT): AstNode | null {
    try {
      // Handle error tokens in expressions too
      if (this.check(TokenType.TK_ERROR)) {
        const errorToken = this.advance()!;
        const message = errorToken.value ? String(errorToken.value) : "Unexpected token";
        this.errorAt(message, errorToken.pos, errorToken.end);
        return null;
      }

      const prefixRule = this.getRule(this.peek()?.type).prefix;
      
      // *** FIX: If there's no prefix rule, it's not a valid expression start. ***
      // Report error and consume the token to prevent an infinite loop.
      if (!prefixRule) {
        this.error("Unexpected token in expression");
        this.advance(); // Consume the invalid token
        return null;
      }

      this.advance();
      let left = prefixRule();
      if (!left) return null;

      while (precedence <= this.getRule(this.peek()?.type).precedence) {
        const infixRule = this.getRule(this.peek()?.type).infix;
        if (!infixRule) break;

        this.advance();
        left = infixRule(left);
        if (!left) break;
      }

      return left;
    } catch (error) {
      this.synchronize(RecoveryMode.EXPRESSION);
      return null;
    }
  }

  // ========== STATEMENT PARSERS ==========

  private parseVariableDeclaration(): VariableDeclarationNode {
    const start = this.previous()!.pos;
    const kind = this.previous()!.type === TokenType.TK_CONST ? 'const' : 'let';
    const declarations: VariableDeclaratorNode[] = [];

    do {
      const declarator = this.parseVariableDeclarator();
      if (declarator) {
        declarations.push(declarator);
      }
    } while (this.match(TokenType.TK_COMMA));

    this.consume(TokenType.TK_SCOL, "Expected ';' after variable declaration");

    return {
      type: 'VariableDeclaration',
      start,
      end: this.previous()!.end,
      kind,
      declarations
    };
  }

  private parseVariableDeclarator(): VariableDeclaratorNode | null {
    const start = this.peek()?.pos || 0;
    
    if (!this.check(TokenType.TK_LABEL)) {
      this.error("Expected variable name");
      return null;
    }

    const id = this.parseIdentifierName();
    if (!id) return null;

    let init: AstNode | null = null;
    if (this.match(TokenType.TK_ASSIGN)) {
      init = this.parseExpression();
    }

    return {
      type: 'VariableDeclarator',
      start,
      end: this.previous()!.end,
      id,
      init
    };
  }

  private parseFunctionDeclaration(): FunctionDeclarationNode | null {
    const start = this.previous()!.pos;

    // Function declarations must have a name
    if (!this.check(TokenType.TK_LABEL)) {
      this.error("Expected function name");
      return null;
    }

    const id = this.parseIdentifierName();
    if (!id) return null;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after function name");

    const params: IdentifierNode[] = [];
    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        const param = this.parseIdentifierName();
        if (param) {
          params.push(param);
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RPAREN, "Expected ')' after parameters");

    // Consume the opening brace before parsing the block
    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' to start function body");

    // Pass the consumed brace token to the block parser
    const body = this.parseBlockStatement(openingBrace, "function body");

    return {
      type: 'FunctionDeclaration',
      start,
      end: body.end,
      id,
      params,
      body
    };
  }

  private parseIfStatement(): IfStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'if'");
    const test = this.parseExpression();
    if (!test) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after if condition");

    const consequent = this.parseStatement();
    if (!consequent) return null;

    let alternate: AstNode | null = null;
    if (this.match(TokenType.TK_ELSE)) {
      alternate = this.parseStatement();
    }

    return {
      type: 'IfStatement',
      start,
      end: (alternate || consequent).end,
      test,
      consequent,
      alternate
    };
  }

  private parseWhileStatement(): WhileStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'while'");
    const test = this.parseExpression();
    if (!test) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after while condition");

    const body = this.parseStatement();
    if (!body) return null;

    return {
      type: 'WhileStatement',
      start,
      end: body.end,
      test,
      body
    };
  }

  private parseForStatement(): ForStatementNode | ForInStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'for'");

    // Check for for-in loop
    if (this.check(TokenType.TK_LABEL)) {
      const checkpoint = this.current;
      const left = this.parseExpression();
      
      if (left && this.match(TokenType.TK_IN)) {
        // This is a for-in loop
        const right = this.parseExpression();
        if (!right) return null;

        this.consume(TokenType.TK_RPAREN, "Expected ')' after for-in");
        const body = this.parseStatement();
        if (!body) return null;

        return {
          type: 'ForInStatement',
          start,
          end: body.end,
          left,
          right,
          body
        };
      } else {
        // Reset and parse as regular for loop
        this.current = checkpoint;
      }
    }

    // Regular for loop
    let init: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL)) {
      if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        init = this.parseVariableDeclaration();
      } else {
        init = this.parseExpression();
        this.consume(TokenType.TK_SCOL, "Expected ';' after for loop initializer");
      }
    } else {
      this.advance(); // consume semicolon
    }

    let test: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL)) {
      test = this.parseExpression();
    }
    this.consume(TokenType.TK_SCOL, "Expected ';' after for loop condition");

    let update: AstNode | null = null;
    if (!this.check(TokenType.TK_RPAREN)) {
      update = this.parseExpression();
    }
    this.consume(TokenType.TK_RPAREN, "Expected ')' after for clauses");

    const body = this.parseStatement();
    if (!body) return null;

    return {
      type: 'ForStatement',
      start,
      end: body.end,
      init,
      test,
      update,
      body
    };
  }

  private parseReturnStatement(): ReturnStatementNode {
    const start = this.previous()!.pos;

    let argument: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL) && !this.isAtEnd()) {
      argument = this.parseExpression();
    }

    this.consume(TokenType.TK_SCOL, "Expected ';' after return value");

    return {
      type: 'ReturnStatement',
      start,
      end: this.previous()!.end,
      argument
    };
  }

  private parseBreakStatement(): BreakStatementNode {
    const start = this.previous()!.pos;
    this.consume(TokenType.TK_SCOL, "Expected ';' after 'break'");

    return {
      type: 'BreakStatement',
      start,
      end: this.previous()!.end,
      label: null // ucode doesn't support labeled breaks
    };
  }

  private parseContinueStatement(): ContinueStatementNode {
    const start = this.previous()!.pos;
    this.consume(TokenType.TK_SCOL, "Expected ';' after 'continue'");

    return {
      type: 'ContinueStatement',
      start,
      end: this.previous()!.end,
      label: null // ucode doesn't support labeled continues
    };
  }

  private parseTryStatement(): TryStatementNode | null {
    const start = this.previous()!.pos;

    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' after 'try'");
    const block = this.parseBlockStatement(openingBrace, "try block");

    let handler: CatchClauseNode | null = null;
    if (this.match(TokenType.TK_CATCH)) {
      const catchStart = this.previous()!.pos;
      
      let param: IdentifierNode | null = null;
      if (this.match(TokenType.TK_LPAREN)) {
        param = this.parseIdentifierName();
        this.consume(TokenType.TK_RPAREN, "Expected ')' after catch parameter");
      }

      const catchOpeningBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' after 'catch'");
      const body = this.parseBlockStatement(catchOpeningBrace, "catch block");

      handler = {
        type: 'CatchClause',
        start: catchStart,
        end: body.end,
        param,
        body
      };
    }

    if (!handler) {
      this.error("Missing catch clause after try");
      return null;
    }

    return {
      type: 'TryStatement',
      start,
      end: handler.end,
      block,
      handler,
      finalizer: null // ucode doesn't support finally
    };
  }

  // Note: parseThrowStatement removed as ucode doesn't support throw statements

  private parseSwitchStatement(): SwitchStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'switch'");
    const discriminant = this.parseExpression();
    if (!discriminant) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after switch expression");
    this.consume(TokenType.TK_LBRACE, "Expected '{' before switch body");

    const cases: SwitchCaseNode[] = [];
    while (!this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
      if (this.match(TokenType.TK_CASE)) {
        const caseStart = this.previous()!.pos;
        const test = this.parseExpression();
        this.consume(TokenType.TK_COLON, "Expected ':' after case value");

        const consequent: AstNode[] = [];
        while (!this.check(TokenType.TK_CASE) && !this.check(TokenType.TK_DEFAULT) && 
               !this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
          const stmt = this.parseStatement();
          if (stmt) consequent.push(stmt);
        }

        cases.push({
          type: 'SwitchCase',
          start: caseStart,
          end: consequent.length > 0 ? consequent[consequent.length - 1]!.end : caseStart,
          test,
          consequent
        });
      } else if (this.match(TokenType.TK_DEFAULT)) {
        const defaultStart = this.previous()!.pos;
        this.consume(TokenType.TK_COLON, "Expected ':' after 'default'");

        const consequent: AstNode[] = [];
        while (!this.check(TokenType.TK_CASE) && !this.check(TokenType.TK_DEFAULT) && 
               !this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
          const stmt = this.parseStatement();
          if (stmt) consequent.push(stmt);
        }

        cases.push({
          type: 'SwitchCase',
          start: defaultStart,
          end: consequent.length > 0 ? consequent[consequent.length - 1]!.end : defaultStart,
          test: null, // null indicates default case
          consequent
        });
      } else {
        this.error("Expected 'case' or 'default' in switch statement");
        break;
      }
    }

    this.consume(TokenType.TK_RBRACE, "Expected '}' after switch body");

    return {
      type: 'SwitchStatement',
      start,
      end: this.previous()!.end,
      discriminant,
      cases
    };
  }

  private parseBlockStatement(openingBrace?: Token, context: string = "block"): BlockStatementNode {
    // If no opening brace provided, get it from previous token
    const actualOpeningBrace = openingBrace || this.previous();
    const start = actualOpeningBrace?.pos || this.peek()?.pos || 0;
    
    const body: AstNode[] = [];
    while (!this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
      try {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      } catch (error) {
        this.synchronize(RecoveryMode.STATEMENT);
        if (this.isAtEnd()) break;
      }
    }

    let end = start;
    
    // Check if the file ended before the block was closed
    if (this.isAtEnd()) {
      if (this.previous()?.type !== TokenType.TK_RBRACE) {
        // Report the error at the location of the opening brace for better context
        if (actualOpeningBrace) {
          this.errorAt(`Unclosed ${context}, expected '}' to match this '{'`, actualOpeningBrace.pos, actualOpeningBrace.end);
        } else {
          this.error(`Unclosed ${context}, expected '}'`);
        }
      }
      end = this.previous()?.end || start;
    } else if (this.check(TokenType.TK_RBRACE)) {
      // Found the closing brace
      this.advance();
      end = this.previous()!.end;
    } else {
      // Missing closing brace but not at EOF
      if (actualOpeningBrace) {
        this.errorAt(`Expected '}' to close ${context}`, actualOpeningBrace.pos, actualOpeningBrace.end);
      } else {
        this.error(`Expected '}' to close ${context}`);
      }
      end = this.previous()?.end || start;
    }

    return {
      type: 'BlockStatement',
      start,
      end,
      body
    };
  }

  private parseExpressionStatement(): ExpressionStatementNode | null {
    const start = this.peek()?.pos || 0;
    const expression = this.parseExpression();
    if (!expression) return null;

    this.consume(TokenType.TK_SCOL, "Expected ';' after expression");

    return {
      type: 'ExpressionStatement',
      start,
      end: this.previous()!.end,
      expression
    };
  }

  private parseEmptyStatement(): EmptyStatementNode {
    const start = this.previous()!.pos;
    return {
      type: 'EmptyStatement',
      start,
      end: this.previous()!.end
    };
  }

  // ========== EXPRESSION PARSERS ==========

  private parseIdentifier(): IdentifierNode | null {
    const token = this.previous()!; // Token already consumed by parseExpression
    
    if (token.type !== TokenType.TK_LABEL) {
      this.error("Expected identifier");
      return null;
    }

    return {
      type: 'Identifier',
      start: token.pos,
      end: token.end,
      name: token.value as string
    };
  }

  // Parse identifier when we need to consume the token (not as prefix)
  private parseIdentifierName(): IdentifierNode | null {
    if (!this.check(TokenType.TK_LABEL)) {
      this.error("Expected identifier");
      return null;
    }

    const token = this.advance()!;
    return {
      type: 'Identifier',
      start: token.pos,
      end: token.end,
      name: token.value as string
    };
  }

  // ========== PARSER UTILITIES ==========

  private initializeParseRules(): void {
    // Primary expressions
    this.rules.set(TokenType.TK_NUMBER, { 
      prefix: () => this.parseLiteral('number'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_DOUBLE, { 
      prefix: () => this.parseLiteral('double'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_STRING, { 
      prefix: () => this.parseLiteral('string'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_TRUE, { 
      prefix: () => this.parseLiteral('boolean'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_FALSE, { 
      prefix: () => this.parseLiteral('boolean'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_NULL, { 
      prefix: () => this.parseLiteral('null'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_LABEL, { 
      prefix: () => this.parseIdentifier(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_THIS, { 
      prefix: () => this.parseThis(), 
      precedence: Precedence.NONE 
    });

    // Grouping
    this.rules.set(TokenType.TK_LPAREN, { 
      prefix: () => this.parseGrouping(), 
      infix: (left) => this.parseCall(left),
      precedence: Precedence.CALL 
    });

    // Array and object literals
    this.rules.set(TokenType.TK_LBRACK, { 
      prefix: () => this.parseArray(),
      infix: (left) => this.parseMemberAccess(left),
      precedence: Precedence.CALL 
    });
    this.rules.set(TokenType.TK_LBRACE, { 
      prefix: () => this.parseObject(), 
      precedence: Precedence.NONE 
    });

    // Unary operators
    this.rules.set(TokenType.TK_NOT, { 
      prefix: () => this.parseUnary(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_SUB, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parseBinary(left),
      precedence: Precedence.ADDITIVE 
    });
    this.rules.set(TokenType.TK_ADD, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parseBinary(left),
      precedence: Precedence.ADDITIVE 
    });
    this.rules.set(TokenType.TK_COMPL, { 
      prefix: () => this.parseUnary(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_INC, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parsePostfix(left),
      precedence: Precedence.POSTFIX 
    });
    this.rules.set(TokenType.TK_DEC, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parsePostfix(left),
      precedence: Precedence.POSTFIX 
    });

    // Binary operators
    this.addBinaryRule(TokenType.TK_MUL, Precedence.MULTIPLICATIVE);
    this.addBinaryRule(TokenType.TK_DIV, Precedence.MULTIPLICATIVE);
    this.addBinaryRule(TokenType.TK_MOD, Precedence.MULTIPLICATIVE);
    this.addBinaryRule(TokenType.TK_EXP, Precedence.EXPONENTIAL);
    
    this.addBinaryRule(TokenType.TK_LT, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_LE, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_GT, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_GE, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_IN, Precedence.RELATIONAL);
    
    this.addBinaryRule(TokenType.TK_EQ, Precedence.EQUALITY);
    this.addBinaryRule(TokenType.TK_NE, Precedence.EQUALITY);
    this.addBinaryRule(TokenType.TK_EQS, Precedence.EQUALITY);
    this.addBinaryRule(TokenType.TK_NES, Precedence.EQUALITY);
    
    this.addBinaryRule(TokenType.TK_BAND, Precedence.BITWISE_AND);
    this.addBinaryRule(TokenType.TK_BXOR, Precedence.BITWISE_XOR);
    this.addBinaryRule(TokenType.TK_BOR, Precedence.BITWISE_OR);
    this.addBinaryRule(TokenType.TK_LSHIFT, Precedence.SHIFT);
    this.addBinaryRule(TokenType.TK_RSHIFT, Precedence.SHIFT);
    
    this.addBinaryRule(TokenType.TK_AND, Precedence.LOGICAL_AND);
    this.addBinaryRule(TokenType.TK_OR, Precedence.LOGICAL_OR);
    this.addBinaryRule(TokenType.TK_NULLISH, Precedence.NULLISH);

    // Assignment operators
    this.addAssignmentRule(TokenType.TK_ASSIGN);
    this.addAssignmentRule(TokenType.TK_ASADD);
    this.addAssignmentRule(TokenType.TK_ASSUB);
    this.addAssignmentRule(TokenType.TK_ASMUL);
    this.addAssignmentRule(TokenType.TK_ASDIV);
    this.addAssignmentRule(TokenType.TK_ASMOD);
    this.addAssignmentRule(TokenType.TK_ASEXP);
    this.addAssignmentRule(TokenType.TK_ASLEFT);
    this.addAssignmentRule(TokenType.TK_ASRIGHT);
    this.addAssignmentRule(TokenType.TK_ASBAND);
    this.addAssignmentRule(TokenType.TK_ASBXOR);
    this.addAssignmentRule(TokenType.TK_ASBOR);
    this.addAssignmentRule(TokenType.TK_ASAND);
    this.addAssignmentRule(TokenType.TK_ASOR);
    this.addAssignmentRule(TokenType.TK_ASNULLISH);

    // Member access
    this.rules.set(TokenType.TK_DOT, { 
      infix: (left) => this.parseMemberAccess(left),
      precedence: Precedence.CALL 
    });

    // Conditional operator
    this.rules.set(TokenType.TK_QMARK, { 
      infix: (left) => this.parseConditional(left),
      precedence: Precedence.CONDITIONAL 
    });

    // Delete operator
    this.rules.set(TokenType.TK_DELETE, { 
      prefix: () => this.parseDelete(), 
      precedence: Precedence.NONE 
    });
  }

  private addBinaryRule(tokenType: TokenType, precedence: Precedence): void {
    this.rules.set(tokenType, {
      infix: (left) => this.parseBinary(left),
      precedence
    });
  }

  private addAssignmentRule(tokenType: TokenType): void {
    this.rules.set(tokenType, {
      infix: (left) => this.parseAssignment(left),
      precedence: Precedence.ASSIGNMENT
    });
  }

  // Placeholder implementations for prefix/infix parsers
  private parseLiteral(literalType: string): LiteralNode {
    const token = this.previous()!;
    let value: string | number | boolean | null;

    switch (literalType) {
      case 'number':
        value = Number(token.value);
        break;
      case 'double':
        value = parseFloat(token.value as string);
        break;
      case 'string':
        value = token.value as string;
        break;
      case 'boolean':
        value = token.type === TokenType.TK_TRUE;
        break;
      case 'null':
        value = null;
        break;
      default:
        value = token.value as string;
    }

    return {
      type: 'Literal',
      start: token.pos,
      end: token.end,
      value,
      raw: token.value as string,
      literalType: literalType as any
    };
  }

  private parseThis(): ThisExpressionNode {
    const token = this.previous()!;
    return {
      type: 'ThisExpression',
      start: token.pos,
      end: token.end
    };
  }

  private parseGrouping(): AstNode | null {
    const expression = this.parseExpression();
    this.consume(TokenType.TK_RPAREN, "Expected ')' after expression");
    return expression;
  }

  private parseArray(): ArrayExpressionNode {
    const start = this.previous()!.pos;
    const elements: (AstNode | null)[] = [];

    if (!this.check(TokenType.TK_RBRACK)) {
      do {
        if (this.check(TokenType.TK_COMMA)) {
          elements.push(null); // sparse array
        } else {
          elements.push(this.parseExpression());
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RBRACK, "Expected ']' after array elements");

    return {
      type: 'ArrayExpression',
      start,
      end: this.previous()!.end,
      elements
    };
  }

  private parseObject(): ObjectExpressionNode {
    const start = this.previous()!.pos;
    const properties: PropertyNode[] = [];

    if (!this.check(TokenType.TK_RBRACE)) {
      let expectingComma = false;
      
      while (!this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
        if (expectingComma) {
          if (this.match(TokenType.TK_COMMA)) {
            expectingComma = false;
            continue;
          } else {
            // Missing comma - report error and try to recover
            const prevProperty = properties[properties.length - 1];
            if (prevProperty) {
              this.errorAt("Expected ',' between object properties", prevProperty.end, prevProperty.end);
            }
            // Don't consume any tokens, just continue to parse the next property
            expectingComma = false;
          }
        }
        
        const property = this.parseProperty();
        if (property) {
          properties.push(property);
          expectingComma = true;
        } else {
          // Failed to parse property, try to recover
          this.advance(); // Skip problematic token
        }
      }
    }

    this.consume(TokenType.TK_RBRACE, "Expected '}' after object properties");

    return {
      type: 'ObjectExpression',
      start,
      end: this.previous()!.end,
      properties
    };
  }

  private parseProperty(): PropertyNode | null {
    const start = this.peek()?.pos || 0;
    
    let key: AstNode;
    let computed = false;

    if (this.match(TokenType.TK_LBRACK)) {
      computed = true;
      key = this.parseExpression()!;
      this.consume(TokenType.TK_RBRACK, "Expected ']' after computed property");
    } else if (this.check(TokenType.TK_LABEL)) {
      key = this.parseIdentifierName()!;
    } else if (this.check(TokenType.TK_STRING)) {
      this.advance();
      key = this.parseLiteral('string');
    } else {
      this.error("Expected property name");
      return null;
    }

    this.consume(TokenType.TK_COLON, "Expected ':' after property key");
    const value = this.parseExpression();
    if (!value) return null;

    return {
      type: 'Property',
      start,
      end: value.end,
      key,
      value,
      computed
    };
  }

  private parseUnary(): UnaryExpressionNode | null {
    const operator = this.previous()!;
    const argument = this.parseExpression(Precedence.UNARY);
    if (!argument) return null;

    let operatorStr: string;
    switch (operator.type) {
      case TokenType.TK_NOT: operatorStr = '!'; break;
      case TokenType.TK_SUB: operatorStr = '-'; break;
      case TokenType.TK_ADD: operatorStr = '+'; break;
      case TokenType.TK_COMPL: operatorStr = '~'; break;
      case TokenType.TK_INC: operatorStr = '++'; break;
      case TokenType.TK_DEC: operatorStr = '--'; break;
      default:
        this.error(`Unknown unary operator: ${operator.type}`);
        return null;
    }

    return {
      type: 'UnaryExpression',
      start: operator.pos,
      end: argument.end,
      operator: operatorStr as any,
      argument,
      prefix: true
    };
  }

  private parseBinary(left: AstNode): BinaryExpressionNode | null {
    const operator = this.previous()!;
    const precedence = this.getRule(operator.type).precedence;
    const right = this.parseExpression(precedence + 1);
    if (!right) return null;

    return {
      type: 'BinaryExpression',
      start: left.start,
      end: right.end,
      operator: this.tokenToOperator(operator.type) as any,
      left,
      right
    };
  }

  private parseAssignment(left: AstNode): AssignmentExpressionNode | null {
    const operator = this.previous()!;
    
    // Validate assignment target
    if (!this.isValidAssignmentTarget(left)) {
      this.error("Invalid assignment target");
      return null;
    }
    
    const right = this.parseExpression(Precedence.ASSIGNMENT);
    if (!right) return null;

    return {
      type: 'AssignmentExpression',
      start: left.start,
      end: right.end,
      operator: this.tokenToOperator(operator.type) as any,
      left,
      right
    };
  }

  private isValidAssignmentTarget(node: AstNode): boolean {
    return node.type === 'Identifier' || 
           node.type === 'MemberExpression';
  }

  private parsePostfix(left: AstNode): UnaryExpressionNode {
    const operator = this.previous()!;

    // Postfix ++/-- cannot be the left-hand side of an assignment
    if (this.check(TokenType.TK_ASSIGN)) {
      this.error("Invalid assignment target");
    }

    return {
      type: 'UnaryExpression',
      start: left.start,
      end: operator.end,
      operator: operator.type === TokenType.TK_INC ? '++' : '--',
      argument: left,
      prefix: false // This is key!
    };
  }

  private parseCall(left: AstNode): CallExpressionNode {
    const start = left.start;
    const args: AstNode[] = [];

    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        const arg = this.parseExpression();
        if (arg) args.push(arg);
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RPAREN, "Expected ')' after arguments");

    return {
      type: 'CallExpression',
      start,
      end: this.previous()!.end,
      callee: left,
      arguments: args
    };
  }

  private parseMemberAccess(left: AstNode): MemberExpressionNode | null {
    const operator = this.previous()!;
    const computed = operator.type === TokenType.TK_LBRACK;
    
    let property: AstNode;
    if (computed) {
      property = this.parseExpression()!;
      this.consume(TokenType.TK_RBRACK, "Expected ']' after computed member");
    } else {
      // For dot notation, we need an identifier
      if (!this.check(TokenType.TK_LABEL)) {
        this.errorAt("Expected property name after '.'", operator.end, operator.end);
        return null;
      }
      property = this.parseIdentifierName()!;
    }

    if (!property) return null;

    return {
      type: 'MemberExpression',
      start: left.start,
      end: property.end,
      object: left,
      property,
      computed
    };
  }

  private parseConditional(left: AstNode): ConditionalExpressionNode | null {
    const consequent = this.parseExpression();
    if (!consequent) return null;

    this.consume(TokenType.TK_COLON, "Expected ':' after conditional consequent");
    const alternate = this.parseExpression(Precedence.CONDITIONAL);
    if (!alternate) return null;

    return {
      type: 'ConditionalExpression',
      start: left.start,
      end: alternate.end,
      test: left,
      consequent,
      alternate
    };
  }

  private parseDelete(): DeleteExpressionNode | null {
    const start = this.previous()!.pos;
    const argument = this.parseExpression(Precedence.UNARY);
    if (!argument) return null;

    return {
      type: 'DeleteExpression',
      start,
      end: argument.end,
      argument
    };
  }

  // ========== UTILITY METHODS ==========

  private tokenToOperator(tokenType: TokenType): string {
    const operatorMap: { [key in TokenType]?: string } = {
      [TokenType.TK_ADD]: '+',
      [TokenType.TK_SUB]: '-',
      [TokenType.TK_MUL]: '*',
      [TokenType.TK_DIV]: '/',
      [TokenType.TK_MOD]: '%',
      [TokenType.TK_EXP]: '**',
      [TokenType.TK_EQ]: '==',
      [TokenType.TK_NE]: '!=',
      [TokenType.TK_EQS]: '===',
      [TokenType.TK_NES]: '!==',
      [TokenType.TK_LT]: '<',
      [TokenType.TK_LE]: '<=',
      [TokenType.TK_GT]: '>',
      [TokenType.TK_GE]: '>=',
      [TokenType.TK_AND]: '&&',
      [TokenType.TK_OR]: '||',
      [TokenType.TK_BAND]: '&',
      [TokenType.TK_BOR]: '|',
      [TokenType.TK_BXOR]: '^',
      [TokenType.TK_LSHIFT]: '<<',
      [TokenType.TK_RSHIFT]: '>>',
      [TokenType.TK_IN]: 'in',
      [TokenType.TK_NULLISH]: '??',
      [TokenType.TK_ASSIGN]: '=',
      [TokenType.TK_ASADD]: '+=',
      [TokenType.TK_ASSUB]: '-=',
      [TokenType.TK_ASMUL]: '*=',
      [TokenType.TK_ASDIV]: '/=',
      [TokenType.TK_ASMOD]: '%=',
      [TokenType.TK_ASEXP]: '**=',
      [TokenType.TK_ASLEFT]: '<<=',
      [TokenType.TK_ASRIGHT]: '>>=',
      [TokenType.TK_ASBAND]: '&=',
      [TokenType.TK_ASBXOR]: '^=',
      [TokenType.TK_ASBOR]: '|=',
      [TokenType.TK_ASAND]: '&&=',
      [TokenType.TK_ASOR]: '||=',
      [TokenType.TK_ASNULLISH]: '??='
    };

    return operatorMap[tokenType] || 'unknown';
  }

  private getRule(tokenType?: TokenType): ParseRule {
    if (!tokenType) {
      return { precedence: Precedence.NONE };
    }
    return this.rules.get(tokenType) || { precedence: Precedence.NONE };
  }

  private advance(): Token | undefined {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek()!.type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance()!;

    // For missing semicolons, point to the end of previous token for better UX
    if (type === TokenType.TK_SCOL) {
      const prevToken = this.previous();
      if (prevToken) {
        this.errorAt(message, prevToken.end, prevToken.end);
        // Return a dummy semicolon token positioned right after the previous token
        return { type: TokenType.TK_SCOL, pos: prevToken.end, end: prevToken.end, value: ';' };
      }
    }

    // For other tokens, report at current position
    const badToken = this.peek();
    const errorPos = badToken?.pos ?? this.previous()?.end ?? 0;
    const errorEnd = badToken?.end ?? errorPos;
    
    this.errorAt(message, errorPos, errorEnd);

    // Return a dummy token with proper positioning
    return { type, pos: errorPos, end: errorEnd, value: '' };
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length || 
           this.peek()?.type === TokenType.TK_EOF;
  }

  private peek(): Token | undefined {
    return this.tokens[this.current];
  }

  private previous(): Token | undefined {
    return this.tokens[this.current - 1];
  }

  private error(message: string): void {
    const token = this.peek();
    const start = token?.pos || 0;
    const end = token?.end || start;

    this.errorAt(message, start, end);
  }

  private errorAt(message: string, start: number, end: number): void {
    const { line, column } = this.calculateLineColumn(start);
    
    this.errors.push({
      message,
      start,
      end,
      line,
      column,
      severity: 'error'
    });
    if (!this.panicMode) {
      this.panicMode = true;
    }
  }

  private calculateLineColumn(position: number): { line: number; column: number } {
    if (!this.sourceCode) return { line: 1, column: 1 };
    
    let line = 1;
    let column = 1;
    
    for (let i = 0; i < position && i < this.sourceCode.length; i++) {
      if (this.sourceCode[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    
    return { line, column };
  }

  // Note: warning method available but not used yet

  private synchronize(mode: RecoveryMode): void {
    this.panicMode = false;

    let syncTokens: string[];
    switch (mode) {
      case RecoveryMode.STATEMENT:
        syncTokens = STATEMENT_SYNC_TOKENS;
        break;
      case RecoveryMode.EXPRESSION:
        syncTokens = EXPRESSION_SYNC_TOKENS;
        break;
      case RecoveryMode.BLOCK:
        syncTokens = ['TK_RBRACE', 'TK_EOF'];
        break;
      default:
        return;
    }

    while (!this.isAtEnd()) {
      const tokenTypeName = TokenType[this.peek()!.type];
      if (syncTokens.includes(tokenTypeName)) {
        return;
      }
      this.advance();
    }
  }
}