/**
 * Declaration statement parsing methods
 * Handles variable declarations and function declarations
 */

import { TokenType } from '../../lexer';
import { UcodeErrorCode } from '../../analysis/errorConstants';
import {
  type AstNode, type VariableDeclarationNode, type VariableDeclaratorNode,
  type FunctionDeclarationNode, type FunctionExpressionNode, type IdentifierNode, type BlockStatementNode,
  type ImportDeclarationNode, type ImportSpecifierNode, type ImportDefaultSpecifierNode,
  type ImportNamespaceSpecifierNode, type LiteralNode, type ExportNamedDeclarationNode,
  type ExportDefaultDeclarationNode, type ExportAllDeclarationNode, type ExportSpecifierNode
} from '../../ast/nodes';
import { ExpressionParser } from '../expressions/expressionParser';

export abstract class DeclarationStatements extends ExpressionParser {

  protected parseVariableDeclaration(jsdocAnchorPos?: number): VariableDeclarationNode {
    const start = this.previous()!.pos;
    const leadingJsDoc = this.findLeadingJsDoc(jsdocAnchorPos ?? start);
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

    const result: VariableDeclarationNode = {
      type: 'VariableDeclaration',
      start,
      end: this.previous()!.end,
      kind,
      declarations
    };
    if (leadingJsDoc) {
      result.leadingJsDoc = leadingJsDoc;
    }
    return result;
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

  protected parseFunctionDeclaration(isExported: boolean = false, jsdocAnchorPos?: number): FunctionDeclarationNode | FunctionExpressionNode | null {
    const start = this.previous()!.pos;
    const leadingJsDoc = this.findLeadingJsDoc(jsdocAnchorPos ?? start);

    // For export default functions, the name is optional (anonymous functions allowed)
    let id: IdentifierNode | null = null;
    
    if (this.check(TokenType.TK_LABEL)) {
      id = this.parseIdentifierName();
      if (!id) return null;
    } else if (!isExported) {
      // Regular function declarations require a name
      this.error("Expected function name");
      return null;
    }
    // For export default, id can be null (anonymous function)

    // Forward declaration: `function name;` — a name with no parameter list or
    // body. Enables use-before-definition and mutual recursion (upstream d9e24e4).
    if (id && this.check(TokenType.TK_SCOL)) {
      const semi = this.advance()!;
      const fwd: FunctionDeclarationNode = {
        type: 'FunctionDeclaration',
        start,
        end: semi.end,
        id,
        params: [],
        // Synthetic empty body so downstream consumers (which assume a body) are safe.
        body: { type: 'BlockStatement', start: semi.pos, end: semi.end, body: [] },
        forwardDeclaration: true,
      };
      if (leadingJsDoc) fwd.leadingJsDoc = leadingJsDoc;
      return fwd;
    }

    this.consume(TokenType.TK_LPAREN, id ? "Expected '(' after function name" : "Expected '(' after 'function'");

    const params: IdentifierNode[] = [];
    let restParam: IdentifierNode | undefined = undefined;
    
    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        // Check for rest parameter (...)
        if (this.match(TokenType.TK_ELLIP)) {
          const param = this.parseIdentifierName();
          if (param) {
            restParam = param;
            // Rest parameter must be the last parameter
            break;
          }
        } else {
          const param = this.parseIdentifierName();
          if (param) {
            params.push(param);
          }
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RPAREN, "Expected ')' after parameters");

    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' to start function body");
    const body = this.parseBlockStatement(openingBrace, "function body");

    // A trailing semicolon after a function declaration is optional — ucode
    // accepts `export function f() {}` without one (upstream 552ca3c), same as a
    // regular function declaration.
    const hadSemicolon = this.check(TokenType.TK_SCOL);
    if (hadSemicolon) {
      this.advance();
    }

    if (id) {
      // Named function - use FunctionDeclarationNode
      const result: FunctionDeclarationNode = {
        type: 'FunctionDeclaration',
        start,
        end: hadSemicolon ? this.previous()!.end : body.end,
        id,
        params,
        body,
        hadSemicolon
      };

      if (restParam) {
        result.restParam = restParam;
      }
      if (leadingJsDoc) {
        result.leadingJsDoc = leadingJsDoc;
      }

      return result;
    } else {
      // Anonymous function - use FunctionExpressionNode
      const result: FunctionExpressionNode = {
        type: 'FunctionExpression',
        start,
        end: hadSemicolon ? this.previous()!.end : body.end,
        id: null,
        params,
        body
      };

      if (restParam) {
        result.restParam = restParam;
      }
      if (leadingJsDoc) {
        result.leadingJsDoc = leadingJsDoc;
      }

      return result;
    }
  }

  protected parseImportDeclaration(): ImportDeclarationNode | null {
    const start = this.previous()!.pos;
    const specifiers: (ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode)[] = [];

    // Parse import specifiers
    if (this.match(TokenType.TK_LBRACE)) {
      // Named imports: import { name1, name2 } from 'module'
      if (!this.check(TokenType.TK_RBRACE)) {
        do {
          const imported = this.parseImportSpecifierName();
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
      // or mixed import: import Default, { named } from 'module'
      const local = this.parseIdentifierName();
      if (!local) return null;

      specifiers.push({
        type: 'ImportDefaultSpecifier',
        start: local.start,
        end: local.end,
        local
      });
      
      // Check for mixed import (default + named or default + namespace)
      if (this.match(TokenType.TK_COMMA)) {
        if (this.match(TokenType.TK_MUL)) {
          // Namespace import after default: import name, * as ns from 'module'
          this.consume(TokenType.TK_LABEL, "Expected 'as' after '*' in import");
          if (this.previous()!.value !== 'as') {
            this.error("Expected 'as' after '*' in import");
            return null;
          }

          const nsLocal = this.parseIdentifierName();
          if (!nsLocal) return null;

          specifiers.push({
            type: 'ImportNamespaceSpecifier',
            start: this.previous()!.pos,
            end: nsLocal.end,
            local: nsLocal
          });
        } else if (this.match(TokenType.TK_LBRACE)) {
          // Parse named imports after default
          if (!this.check(TokenType.TK_RBRACE)) {
            do {
              const imported = this.parseImportSpecifierName();
              if (!imported) continue;

              let namedLocal = imported;
              if (this.match(TokenType.TK_LABEL) && this.previous()!.value === 'as') {
                const parsedLocal = this.parseIdentifierName();
                if (!parsedLocal) continue;
                namedLocal = parsedLocal;
              }

              specifiers.push({
                type: 'ImportSpecifier',
                start: imported.start,
                end: namedLocal.end,
                imported,
                local: namedLocal
              });
            } while (this.match(TokenType.TK_COMMA));
          }

          this.consume(TokenType.TK_RBRACE, "Expected '}' after import specifiers");
        } else {
          this.error("Expected '{' or '*' after ',' in mixed import");
          return null;
        }
      }
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

    this.consume(TokenType.TK_SCOL, "Expected ';' after import statement", UcodeErrorCode.MISSING_SEMICOLON);

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
      const declaration = this.parseExportDefaultDeclaration(start);
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
      
      let isFuncDecl = false;
      if (this.match(TokenType.TK_FUNC)) {
        declaration = this.parseFunctionDeclaration(true, start); // Exported function
        isFuncDecl = true;
      } else if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        declaration = this.parseVariableDeclaration(start);
      }

      if (!declaration) return null;

      // `export function NAME(){}` may be followed by an optional `;`. ucode ≤24.10
      // REQUIRES it; main made it optional. parseFunctionDeclaration already
      // consumed/recorded it (node.hadSemicolon), so read it from the declaration —
      // a version-gated diagnostic flags the no-`;` form on older targets. (The
      // var-decl forms consume their own `;`, so this only matters for functions.)
      return {
        type: 'ExportNamedDeclaration',
        start,
        end: declaration.end,
        declaration,
        specifiers: [],
        source: null,
        ...(isFuncDecl ? { declarationHadSemicolon: (declaration as FunctionDeclarationNode).hadSemicolon === true } : {}),
      };
    }

    this.error("Expected declaration or export specifiers after 'export'");
    return null;
  }

  private parseExportDefaultDeclaration(jsdocAnchorPos?: number): AstNode | null {
    // For export default, we can export a function or expression
    if (this.match(TokenType.TK_FUNC)) {
      return this.parseFunctionDeclaration(true, jsdocAnchorPos); // Exported function
    } else {
      // Parse as expression
      const expr = this.parseExpression();
      if (expr) {
        this.consume(TokenType.TK_SCOL, "Expected ';' after export default expression", UcodeErrorCode.MISSING_SEMICOLON);
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

    this.consume(TokenType.TK_SCOL, "Expected ';' after export * declaration", UcodeErrorCode.MISSING_SEMICOLON);

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
          let parsedExported: IdentifierNode | null;
          if (this.check(TokenType.TK_DEFAULT)) {
            // export { x as default } — alias a local binding to the default export.
            // Valid in ucode on all versions (oracle-verified). Finding #11.
            const token = this.advance()!;
            parsedExported = { type: 'Identifier', start: token.pos, end: token.end, name: 'default' };
          } else {
            parsedExported = this.parseIdentifierName();
          }
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

    this.consume(TokenType.TK_SCOL, "Expected ';' after export declaration", UcodeErrorCode.MISSING_SEMICOLON);

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
  protected abstract override parseBlockStatement(openingBrace: any, context: string): BlockStatementNode;
}