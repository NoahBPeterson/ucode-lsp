/**
 * Parser utility methods
 */

import { type Token, TokenType } from '../lexer';
import { type ParseWarning, RecoveryMode, STATEMENT_SYNC_TOKENS, EXPRESSION_SYNC_TOKENS, type ParseError } from './types';
import { type JsDocCommentNode } from '../ast/nodes';
import { UcodeErrorCode } from '../analysis/errorConstants';

export class ParserUtils {
  protected tokens: Token[];
  protected current: number = 0;
  protected errors: ParseError[] = [];
  protected warnings: ParseWarning[] = [];
  protected panicMode = false;
  protected comments: Token[] = [];
  protected sourceText: string = '';

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  setComments(comments: Token[]) {
    this.comments = comments;
  }

  setSourceText(text: string) {
    this.sourceText = text;
  }

  protected findLeadingJsDoc(nodeStartPos: number): JsDocCommentNode | undefined {
    // Reverse scan for the JSDoc immediately preceding the node. Plain `//`/`/* */`
    // comments between the JSDoc and the node (or trailing on the JSDoc's own line) are
    // TRANSPARENT — they don't sever the attachment — but any real code in the gap does.
    let gapEnd = nodeStartPos;
    for (let i = this.comments.length - 1; i >= 0; i--) {
      const c = this.comments[i]!;
      if (c.end > gapEnd) continue;          // comment lies after the running boundary
      if (c.end < nodeStartPos - 500) break; // too far away
      // Only whitespace may sit between this comment and the running boundary; non-comment
      // code (e.g. an intervening statement) means the JSDoc isn't this node's.
      if (this.sourceText) {
        const between = this.sourceText.substring(c.end, gapEnd);
        if (between.trim().length > 0) break;
      }
      const val = String(c.value);
      if (val.startsWith('*')) { // /** ... */ — the leading JSDoc
        return { type: 'JsDocComment', value: val, start: c.pos, end: c.end };
      }
      // A plain comment is transparent: keep scanning earlier, past it.
      gapEnd = c.pos;
    }
    return undefined;
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
      [TokenType.TK_COMMA]: ',',
      [TokenType.TK_NULLISH]: '??',
      [TokenType.TK_NOT]: '!',
      [TokenType.TK_COMPL]: '~',
      [TokenType.TK_INC]: '++',
      [TokenType.TK_DEC]: '--',
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

  protected consume(type: TokenType, message: string, code?: string): Token | null {
    if (this.check(type)) {
      return this.advance();
    }

    this.error(message, code);
    return null;
  }

  // Every parser diagnostic carries a stable code (#103). The default umbrella is
  // UC6001 (SYNTAX_ERROR); call sites pass a more specific code where one fits
  // (e.g. UC6003 for a missing semicolon).
  protected error(message: string, code: string = UcodeErrorCode.SYNTAX_ERROR): void {
    const token = this.peek();
    if (token) {
      this.errorAt(message, token.pos, token.end, code);
    } else {
      this.errors.push({
        message,
        start: this.tokens[this.tokens.length - 1]?.end || 0,
        end: this.tokens[this.tokens.length - 1]?.end || 0,
        severity: 'error',
        code,
      });
    }
  }

  protected errorAt(message: string, pos: number, end: number, code: string = UcodeErrorCode.SYNTAX_ERROR): void {
    if (this.panicMode) return;

    this.panicMode = true;
    this.errors.push({ message, start: pos, end, severity: 'error', code });
  }

  protected warningAt(message: string, pos: number, end: number, code: string = UcodeErrorCode.SYNTAX_ERROR): void {
    this.warnings.push({ message, start: pos, end, severity: 'warning', code });
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