/**
 * Main ucode parser implementation
 * Combines all parser modules into a single cohesive parser
 */

import { Token } from '../lexer';
import { AstNode, ProgramNode } from '../ast/nodes';
import { ParseResult, RecoveryMode } from './types';
import { StatementParser } from './statements/statementParser';

export class UcodeParser extends StatementParser {
  
  constructor(tokens: Token[], _sourceCode: string = '') {
    super(tokens);
    this.initializeParseRules();
  }

  public parse(): ParseResult {
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
}