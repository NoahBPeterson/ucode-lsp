/**
 * Declaration statement parsing methods
 * Handles variable declarations and function declarations
 */

import { TokenType } from '../../lexer';
import { 
  AstNode, VariableDeclarationNode, VariableDeclaratorNode, 
  FunctionDeclarationNode, IdentifierNode, BlockStatementNode,
  ImportDeclarationNode, ImportSpecifierNode, ImportDefaultSpecifierNode,
  ImportNamespaceSpecifierNode, LiteralNode, ExportNamedDeclarationNode,
  ExportDefaultDeclarationNode, ExportAllDeclarationNode, ExportSpecifierNode
} from '../../ast/nodes';
import { ExpressionParser } from '../expressions/expressionParser';

export abstract class DeclarationStatements extends ExpressionParser {

  protected parseVariableDeclaration(): VariableDeclarationNode {
    const start = this.previous()!.pos;
    const kind = this.previous()!.type === TokenType.TK_CONST ? 'const' : 'let';
    const declarations: VariableDeclaratorNode[] = [];

    do {
      const declarator = this.parseVariableDeclarator();
      if (declarator) {
        declarations.push(declarator);
      }
    } while (this.match(TokenType.TK_COMMA));

    // Check for semicolon but don't let missing semicolon trigger panic mode
    const hadSemicolon = this.check(TokenType.TK_SCOL);
    if (hadSemicolon) {
      this.advance();
    } else {
      // Record error but continue parsing
      this.errorAt("Expected ';' after variable declaration", 
                   this.previous()?.end || start, 
                   this.previous()?.end || start);
      // Reset panic mode for missing semicolon
      this.panicMode = false;
    }

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

  protected parseFunctionDeclaration(): FunctionDeclarationNode | null {
    const start = this.previous()!.pos;

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

    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' to start function body");
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

  protected parseImportDeclaration(): ImportDeclarationNode | null {
    const start = this.previous()!.pos;
    const specifiers: (ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode)[] = [];

    // Parse import specifiers
    if (this.match(TokenType.TK_LBRACE)) {
      // Named imports: import { name1, name2 } from 'module'
      if (!this.check(TokenType.TK_RBRACE)) {
        do {
          const imported = this.parseIdentifierName();
          if (!imported) continue;

          let local = imported;
          if (this.match(TokenType.TK_LABEL) && this.previous()!.value === 'as') {
            const parsedLocal = this.parseIdentifierName();
            if (!parsedLocal) continue;
            local = parsedLocal;
          }

          specifiers.push({
            type: 'ImportSpecifier',
            start: imported.start,
            end: local.end,
            imported,
            local
          });
        } while (this.match(TokenType.TK_COMMA));
      }
      
      this.consume(TokenType.TK_RBRACE, "Expected '}' after import specifiers");
    } else if (this.match(TokenType.TK_MUL)) {
      // Namespace import: import * as name from 'module'
      this.consume(TokenType.TK_LABEL, "Expected 'as' after '*' in import");
      if (this.previous()!.value !== 'as') {
        this.error("Expected 'as' after '*' in import");
        return null;
      }
      
      const local = this.parseIdentifierName();
      if (!local) return null;

      specifiers.push({
        type: 'ImportNamespaceSpecifier',
        start: this.previous()!.pos,
        end: local.end,
        local
      });
    } else {
      // Default import: import name from 'module'
      const local = this.parseIdentifierName();
      if (!local) return null;

      specifiers.push({
        type: 'ImportDefaultSpecifier',
        start: local.start,
        end: local.end,
        local
      });
    }

    // Parse 'from' keyword
    if (!this.match(TokenType.TK_FROM)) {
      this.error("Expected 'from' after import specifiers");
      return null;
    }

    // Parse module source
    if (!this.check(TokenType.TK_STRING)) {
      this.error("Expected string literal after 'from'");
      return null;
    }

    const source = this.advance()!;
    const sourceLiteral: LiteralNode = {
      type: 'Literal',
      start: source.pos,
      end: source.end,
      value: String(source.value),
      raw: String(source.value),
      literalType: 'string'
    };

    this.consume(TokenType.TK_SCOL, "Expected ';' after import statement");

    return {
      type: 'ImportDeclaration',
      start,
      end: this.previous()!.end,
      specifiers,
      source: sourceLiteral
    };
  }

  protected parseExportDeclaration(): ExportNamedDeclarationNode | ExportDefaultDeclarationNode | ExportAllDeclarationNode | null {
    const start = this.previous()!.pos;

    // Check for export default
    if (this.match(TokenType.TK_DEFAULT)) {
      const declaration = this.parseExportDefaultDeclaration();
      if (!declaration) return null;

      return {
        type: 'ExportDefaultDeclaration',
        start,
        end: declaration.end,
        declaration
      };
    }

    // Check for export * from 'module'
    if (this.match(TokenType.TK_MUL)) {
      return this.parseExportAllDeclaration(start);
    }

    // Check for export { specifiers } from 'module'
    if (this.match(TokenType.TK_LBRACE)) {
      return this.parseExportNamedDeclaration(start);
    }

    // Check for export declarations (export function/let/const)
    if (this.check(TokenType.TK_FUNC) || this.check(TokenType.TK_LOCAL) || this.check(TokenType.TK_CONST)) {
      let declaration: AstNode | null = null;
      
      if (this.match(TokenType.TK_FUNC)) {
        declaration = this.parseFunctionDeclaration();
      } else if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        declaration = this.parseVariableDeclaration();
      }

      if (!declaration) return null;

      return {
        type: 'ExportNamedDeclaration',
        start,
        end: declaration.end,
        declaration,
        specifiers: [],
        source: null
      };
    }

    this.error("Expected declaration or export specifiers after 'export'");
    return null;
  }

  private parseExportDefaultDeclaration(): AstNode | null {
    // For export default, we can export a function or expression
    if (this.match(TokenType.TK_FUNC)) {
      return this.parseFunctionDeclaration();
    } else {
      // Parse as expression
      const expr = this.parseExpression();
      if (expr) {
        this.consume(TokenType.TK_SCOL, "Expected ';' after export default expression");
      }
      return expr;
    }
  }

  private parseExportAllDeclaration(start: number): ExportAllDeclarationNode | null {
    let exported: IdentifierNode | null = null;
    
    // Check for export * as name from 'module'
    if (this.match(TokenType.TK_LABEL) && this.previous()!.value === 'as') {
      exported = this.parseIdentifierName();
      if (!exported) return null;
    }

    // Parse 'from' keyword
    if (!this.match(TokenType.TK_FROM)) {
      this.error("Expected 'from' after export * declaration");
      return null;
    }

    // Parse module source
    if (!this.check(TokenType.TK_STRING)) {
      this.error("Expected string literal after 'from'");
      return null;
    }

    const source = this.advance()!;
    const sourceLiteral: LiteralNode = {
      type: 'Literal',
      start: source.pos,
      end: source.end,
      value: String(source.value),
      raw: String(source.value),
      literalType: 'string'
    };

    this.consume(TokenType.TK_SCOL, "Expected ';' after export * declaration");

    return {
      type: 'ExportAllDeclaration',
      start,
      end: this.previous()!.end,
      source: sourceLiteral,
      exported
    };
  }

  private parseExportNamedDeclaration(start: number): ExportNamedDeclarationNode | null {
    const specifiers: ExportSpecifierNode[] = [];

    // Parse export specifiers
    if (!this.check(TokenType.TK_RBRACE)) {
      do {
        const local = this.parseIdentifierName();
        if (!local) continue;

        let exported = local;
        if (this.match(TokenType.TK_LABEL) && this.previous()!.value === 'as') {
          const parsedExported = this.parseIdentifierName();
          if (!parsedExported) continue;
          exported = parsedExported;
        }

        specifiers.push({
          type: 'ExportSpecifier',
          start: local.start,
          end: exported.end,
          local,
          exported
        });
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RBRACE, "Expected '}' after export specifiers");

    let source: LiteralNode | null = null;
    if (this.match(TokenType.TK_FROM)) {
      if (!this.check(TokenType.TK_STRING)) {
        this.error("Expected string literal after 'from'");
        return null;
      }

      const sourceToken = this.advance()!;
      source = {
        type: 'Literal',
        start: sourceToken.pos,
        end: sourceToken.end,
        value: String(sourceToken.value),
        raw: String(sourceToken.value),
        literalType: 'string'
      };
    }

    this.consume(TokenType.TK_SCOL, "Expected ';' after export declaration");

    return {
      type: 'ExportNamedDeclaration',
      start,
      end: this.previous()!.end,
      declaration: null,
      specifiers,
      source
    };
  }

  // Abstract method that must be implemented by subclasses
  protected abstract parseBlockStatement(openingBrace: any, context: string): BlockStatementNode;
}