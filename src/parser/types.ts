/**
 * Parser types and interfaces for ucode AST generation
 */

import { AstNode } from '../ast/nodes';

export interface ParseResult {
  ast: AstNode | null;
  errors: ParseError[];
  warnings: ParseWarning[];
}

export interface ParseError {
  message: string;
  start: number;
  end: number;
  line?: number;
  column?: number;
  severity: 'error';
  code?: string;
}

export interface ParseWarning {
  message: string;
  start: number;
  end: number;
  line?: number;
  column?: number;
  severity: 'warning';
  code?: string;
}

export type Diagnostic = ParseError | ParseWarning;

// Operator precedence levels (from lowest to highest)
// Based on ucode compiler's precedence rules
export enum Precedence {
  NONE = 0,
  ASSIGNMENT = 1,     // = += -= *= /= %= **= <<= >>= &= ^= |= &&= ||= ??=
  CONDITIONAL = 2,    // ?:
  NULLISH = 3,        // ??
  LOGICAL_OR = 4,     // ||
  LOGICAL_AND = 5,    // &&
  BITWISE_OR = 6,     // |
  BITWISE_XOR = 7,    // ^
  BITWISE_AND = 8,    // &
  EQUALITY = 9,       // == != === !==
  RELATIONAL = 10,    // < > <= >= in
  SHIFT = 11,         // << >>
  ADDITIVE = 12,      // + -
  MULTIPLICATIVE = 13, // * / %
  EXPONENTIAL = 14,   // **
  UNARY = 15,         // ! ~ + - ++ --
  POSTFIX = 16,       // ++ --
  CALL = 17,          // () [] . ?.
  PRIMARY = 18        // literals, identifiers, parentheses
}

// Parser rule for each token type - maps to Pratt parser approach
export interface ParseRule {
  prefix?: PrefixParseFn;
  infix?: InfixParseFn;
  precedence: Precedence;
}

export type PrefixParseFn = () => AstNode | null;
export type InfixParseFn = (left: AstNode) => AstNode | null;

// Error recovery modes
export enum RecoveryMode {
  NONE,           // No recovery, fail immediately
  STATEMENT,      // Recover at statement boundaries (;, }, etc.)
  EXPRESSION,     // Recover at expression boundaries (, ], ), etc.)
  BLOCK          // Recover at block boundaries ({ })
}

// Synchronization points for error recovery
import { TokenType } from '../lexer';

export const STATEMENT_SYNC_TOKENS: TokenType[] = [
  TokenType.TK_SCOL,        // ;
  TokenType.TK_RBRACE,      // }
  TokenType.TK_IF,          // if
  TokenType.TK_WHILE,       // while
  TokenType.TK_FOR,         // for
  TokenType.TK_FUNC,        // function
  TokenType.TK_RETURN,      // return
  TokenType.TK_BREAK,       // break
  TokenType.TK_CONTINUE,    // continue
  TokenType.TK_TRY,         // try
  TokenType.TK_SWITCH,      // switch
  TokenType.TK_LOCAL,       // let
  TokenType.TK_CONST,       // const
  TokenType.TK_EOF          // end of file
];

export const EXPRESSION_SYNC_TOKENS: TokenType[] = [
  TokenType.TK_SCOL,        // ;
  TokenType.TK_RPAREN,      // )
  TokenType.TK_RBRACK,      // ]
  TokenType.TK_RBRACE,      // }
  TokenType.TK_COMMA,       // ,
  TokenType.TK_EOF          // end of file
];