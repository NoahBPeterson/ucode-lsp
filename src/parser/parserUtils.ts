/**
 * Parser utility methods
 */

import { Token, TokenType } from '../lexer';
import { ParseError, ParseWarning, RecoveryMode, STATEMENT_SYNC_TOKENS, EXPRESSION_SYNC_TOKENS } from './types';

export class ParserUtils {
  protected tokens: Token[];
  protected current: number = 0;
  protected errors: ParseError[] = [];
  protected warnings: ParseWarning[] = [];
  protected panicMode = false;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  protected tokenToOperator(tokenType: TokenType): string {
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

  protected isAtEnd(): boolean {
    return this.current >= this.tokens.length || this.peek()?.type === TokenType.TK_EOF;
  }

  protected peek(): Token | null {
    if (this.current >= this.tokens.length) return null;
    return this.tokens[this.current] || null;
  }

  protected previous(): Token | null {
    if (this.current <= 0) return null;
    return this.tokens[this.current - 1] || null;
  }

  protected advance(): Token | null {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  protected check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek()?.type === type;
  }

  protected match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  protected consume(type: TokenType, message: string): Token | null {
    if (this.check(type)) {
      return this.advance();
    }

    this.error(message);
    return null;
  }

  protected error(message: string): void {
    const token = this.peek();
    if (token) {
      this.errorAt(message, token.pos, token.end);
    } else {
      this.errors.push({
        message,
        start: this.tokens[this.tokens.length - 1]?.end || 0,
        end: this.tokens[this.tokens.length - 1]?.end || 0,
        severity: 'error'
      });
    }
  }

  protected errorAt(message: string, pos: number, end: number): void {
    if (this.panicMode) return;
    
    this.panicMode = true;
    this.errors.push({ message, start: pos, end, severity: 'error' });
  }

  protected synchronize(mode: RecoveryMode): void {
    this.panicMode = false;
    
    if (mode === RecoveryMode.STATEMENT) {
      while (!this.isAtEnd()) {
        if (this.previous()?.type === TokenType.TK_SCOL) return;
        
        const current = this.peek()?.type;
        if (current && STATEMENT_SYNC_TOKENS.includes(current)) {
          return;
        }
        
        this.advance();
      }
    } else if (mode === RecoveryMode.EXPRESSION) {
      while (!this.isAtEnd()) {
        const current = this.peek()?.type;
        if (current && EXPRESSION_SYNC_TOKENS.includes(current)) {
          return;
        }
        
        this.advance();
      }
    }
  }
}