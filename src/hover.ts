import {
    TextDocumentPositionParams,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType, isKeyword } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType } from './analysis';
import { typeToString } from './analysis/symbolTable';
import { debugTypeRegistry } from './analysis/debugTypes';
import { digestTypeRegistry } from './analysis/digestTypes';
import { logTypeRegistry } from './analysis/logTypes';
import { mathTypeRegistry } from './analysis/mathTypes';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { resolvTypeRegistry } from './analysis/resolvTypes';
import { socketTypeRegistry } from './analysis/socketTypes';

export function handleHover(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    analysisResult?: SemanticAnalysisResult
): Hover | undefined {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        return undefined;
    }

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        const token = tokens.find(t => t.pos <= offset && offset <= t.end);
        
        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            const word = token.value;
            
            // Check if this is part of a member expression (e.g., fs.open)
            const memberExpressionInfo = detectMemberExpression(offset, tokens);
            if (memberExpressionInfo && analysisResult) {
                // For member expressions, we could add object-specific hover here
                // For now, fall through to regular symbol analysis
            }
            
            // Check if this is a log module function FIRST (before symbol table)
            if (logTypeRegistry.isLogFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: logTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if this is a log module constant FIRST (before symbol table)
            if (logTypeRegistry.isLogConstant(word)) {
                const constantDoc = logTypeRegistry.getConstantDocumentation(word);
                if (constantDoc) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: constantDoc
                        },
                        range: {
                            start: document.positionAt(token.pos),
                            end: document.positionAt(token.end)
                        }
                    };
                }
            }
            
            // Check if this is a math module function FIRST (before symbol table)
            if (mathTypeRegistry.isMathFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: mathTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if this is a nl80211 module function FIRST (before symbol table)
            if (nl80211TypeRegistry.isNl80211Function(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: nl80211TypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if this is a nl80211 module constant FIRST (before symbol table)
            if (nl80211TypeRegistry.isNl80211Constant(word)) {
                const constantDoc = nl80211TypeRegistry.getConstantDocumentation(word);
                if (constantDoc) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: constantDoc
                        },
                        range: {
                            start: document.positionAt(token.pos),
                            end: document.positionAt(token.end)
                        }
                    };
                }
            }
            
            // Check if this is a digest module function FIRST (before symbol table)
            if (digestTypeRegistry.isDigestFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: digestTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if this is a resolv module function FIRST (before symbol table)
            if (resolvTypeRegistry.isResolvFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: resolvTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if this is a socket module function FIRST (before symbol table)
            if (socketTypeRegistry.isSocketFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: socketTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if this is a socket module constant FIRST (before symbol table)
            if (socketTypeRegistry.isSocketConstant(word)) {
                const constantDoc = socketTypeRegistry.getConstantDocumentation(word);
                if (constantDoc) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: constantDoc
                        },
                        range: {
                            start: document.positionAt(token.pos),
                            end: document.positionAt(token.end)
                        }
                    };
                }
            }
            
            // 1. Check if this is a debug module function FIRST (before symbol table)
            if (debugTypeRegistry.isDebugFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: debugTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // 1. Check for user-defined symbols using the analysis cache
            if (analysisResult) {
                const symbol = analysisResult.symbolTable.lookup(word);
                if (symbol) {
                    let hoverText = '';
                    switch (symbol.type) {
                        case SymbolType.VARIABLE:
                        case SymbolType.PARAMETER:
                            hoverText = `(${symbol.type}) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.FUNCTION:
                            // NOTE: Parameter types are not yet tracked in this example.
                            hoverText = `(function) **${symbol.name}**(): \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.MODULE:
                            hoverText = `(module) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.IMPORTED:
                            // Special handling for module imports
                            if (symbol.importedFrom === 'debug') {
                                // Check if this is a specific debug function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (debugTypeRegistry.isDebugFunction(originalName)) {
                                    hoverText = debugTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getDebugModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'digest') {
                                // Check if this is a specific digest function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (digestTypeRegistry.isDigestFunction(originalName)) {
                                    hoverText = digestTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getDigestModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'log') {
                                // Check if this is a specific log function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (logTypeRegistry.isLogFunction(originalName)) {
                                    hoverText = logTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (logTypeRegistry.isLogConstant(originalName)) {
                                    hoverText = logTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getLogModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'math') {
                                // Check if this is a specific math function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (mathTypeRegistry.isMathFunction(originalName)) {
                                    hoverText = mathTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getMathModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'nl80211') {
                                // Check if this is a specific nl80211 function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (nl80211TypeRegistry.isNl80211Function(originalName)) {
                                    hoverText = nl80211TypeRegistry.getFunctionDocumentation(originalName);
                                } else if (nl80211TypeRegistry.isNl80211Constant(originalName)) {
                                    hoverText = nl80211TypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getNl80211ModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'resolv') {
                                // Check if this is a specific resolv function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (resolvTypeRegistry.isResolvFunction(originalName)) {
                                    hoverText = resolvTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getResolvModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'socket') {
                                // Check if this is a specific socket function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (socketTypeRegistry.isSocketFunction(originalName)) {
                                    hoverText = socketTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (socketTypeRegistry.isSocketConstant(originalName)) {
                                    hoverText = socketTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getSocketModuleDocumentation();
                                }
                            } else {
                                hoverText = `(imported) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            }
                            break;
                    }
                    
                    if (hoverText) {
                        return {
                            contents: { kind: MarkupKind.Markdown, value: hoverText },
                            range: {
                                start: document.positionAt(token.pos),
                                end: document.positionAt(token.end)
                            }
                        };
                    }
                }
            }
            
            // 3. Fallback to built-in functions and keywords
            const documentation = allBuiltinFunctions.get(word);
            if (documentation) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${word}** (built-in function)\n\n${documentation}`
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            if (isKeyword(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${word}** (ucode keyword)`
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
        }
    } catch (error) {
        const wordRange = getWordRangeAtPosition(text, offset);
        if (!wordRange) {
            return undefined;
        }
        
        const word = text.substring(wordRange.start, wordRange.end);
        
        // Check if this is a log module function
        if (logTypeRegistry.isLogFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: logTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a log module constant
        if (logTypeRegistry.isLogConstant(word)) {
            const constantDoc = logTypeRegistry.getConstantDocumentation(word);
            if (constantDoc) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: constantDoc
                    },
                    range: {
                        start: document.positionAt(wordRange.start),
                        end: document.positionAt(wordRange.end)
                    }
                };
            }
        }
        
        // Check if this is a math module function
        if (mathTypeRegistry.isMathFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: mathTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a nl80211 module function
        if (nl80211TypeRegistry.isNl80211Function(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: nl80211TypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a nl80211 module constant
        if (nl80211TypeRegistry.isNl80211Constant(word)) {
            const constantDoc = nl80211TypeRegistry.getConstantDocumentation(word);
            if (constantDoc) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: constantDoc
                    },
                    range: {
                        start: document.positionAt(wordRange.start),
                        end: document.positionAt(wordRange.end)
                    }
                };
            }
        }
        
        // Check if this is a digest module function
        if (digestTypeRegistry.isDigestFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: digestTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a resolv module function
        if (resolvTypeRegistry.isResolvFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: resolvTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a socket module function
        if (socketTypeRegistry.isSocketFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: socketTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a socket module constant
        if (socketTypeRegistry.isSocketConstant(word)) {
            const constantDoc = socketTypeRegistry.getConstantDocumentation(word);
            if (constantDoc) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: constantDoc
                    },
                    range: {
                        start: document.positionAt(wordRange.start),
                        end: document.positionAt(wordRange.end)
                    }
                };
            }
        }
        
        // Check if this is a debug module function
        if (debugTypeRegistry.isDebugFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: debugTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        const documentation = allBuiltinFunctions.get(word);
        if (documentation) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `**${word}** (built-in function)\n\n${documentation}`
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
    }
    
    return undefined;
}

function detectMemberExpression(offset: number, tokens: any[]): { objectName: string; propertyName: string } | undefined {
    // Find the token at the current position
    const currentTokenIndex = tokens.findIndex(t => t.pos <= offset && offset <= t.end);
    if (currentTokenIndex === -1) return undefined;
    
    const currentToken = tokens[currentTokenIndex];
    
    // Look for pattern: LABEL DOT LABEL or LABEL DOT current_position
    // Check if current token is part of a member expression
    
    // Case 1: Hovering over object name in "object.property"
    if (currentTokenIndex + 2 < tokens.length) {
        const nextToken = tokens[currentTokenIndex + 1];
        const afterNextToken = tokens[currentTokenIndex + 2];
        
        if (nextToken.type === TokenType.TK_DOT && 
            afterNextToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: currentToken.value as string,
                propertyName: afterNextToken.value as string
            };
        }
    }
    
    // Case 2: Hovering over property name in "object.property"
    if (currentTokenIndex >= 2) {
        const prevToken = tokens[currentTokenIndex - 1];
        const beforePrevToken = tokens[currentTokenIndex - 2];
        
        if (prevToken.type === TokenType.TK_DOT && 
            beforePrevToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: beforePrevToken.value as string,
                propertyName: currentToken.value as string
            };
        }
    }
    
    return undefined;
}

function getWordRangeAtPosition(text: string, offset: number): { start: number; end: number } | undefined {
    const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let match;
    
    while ((match = wordRegex.exec(text)) !== null) {
        if (match.index <= offset && offset <= match.index + match[0].length) {
            return {
                start: match.index,
                end: match.index + match[0].length
            };
        }
    }
    
    return undefined;
}

function getDebugModuleDocumentation(): string {
    return `## Debug Module

**Runtime debug functionality for ucode scripts**

The debug module provides comprehensive debugging and introspection capabilities for ucode applications.

### Usage

**Named import syntax:**
\`\`\`ucode
import { memdump, traceback } from 'debug';

let stacktrace = traceback(1);
memdump("/tmp/dump.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as debug from 'debug';

let stacktrace = debug.traceback(1);
debug.memdump("/tmp/dump.txt");
\`\`\`

### Available Functions

- **\`memdump()\`** - Write memory dump report to file
- **\`traceback()\`** - Generate stack trace from execution point  
- **\`sourcepos()\`** - Get current source position information
- **\`getinfo()\`** - Get detailed information about a value
- **\`getlocal()\`** - Get the value of a local variable
- **\`setlocal()\`** - Set the value of a local variable
- **\`getupval()\`** - Get the value of an upvalue (closure variable)
- **\`setupval()\`** - Set the value of an upvalue (closure variable)

### Environment Variables

- **\`UCODE_DEBUG_MEMDUMP_ENABLED\`** - Enable/disable automatic memory dumps (default: enabled)
- **\`UCODE_DEBUG_MEMDUMP_SIGNAL\`** - Signal for triggering memory dumps (default: SIGUSR2)
- **\`UCODE_DEBUG_MEMDUMP_PATH\`** - Output directory for memory dumps (default: /tmp)

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getDigestModuleDocumentation(): string {
    return `## Digest Module

**Cryptographic hash functions for ucode scripts**

The digest module provides secure hashing functionality using industry-standard algorithms.

### Usage

**Named import syntax:**
\`\`\`ucode
import { md5, sha256, sha1_file } from 'digest';

let hash = md5("Hello World");
let fileHash = sha256_file("/path/to/file.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as digest from 'digest';

let hash = digest.md5("Hello World");
let fileHash = digest.sha256_file("/path/to/file.txt");
\`\`\`

### Available Functions

**String hashing functions:**
- **\`md5()\`** - Calculate MD5 hash of string
- **\`sha1()\`** - Calculate SHA1 hash of string
- **\`sha256()\`** - Calculate SHA256 hash of string
- **\`sha384()\`** - Calculate SHA384 hash of string (extended)
- **\`sha512()\`** - Calculate SHA512 hash of string (extended)
- **\`md2()\`** - Calculate MD2 hash of string (extended)
- **\`md4()\`** - Calculate MD4 hash of string (extended)

**File hashing functions:**
- **\`md5_file()\`** - Calculate MD5 hash of file
- **\`sha1_file()\`** - Calculate SHA1 hash of file
- **\`sha256_file()\`** - Calculate SHA256 hash of file
- **\`sha384_file()\`** - Calculate SHA384 hash of file (extended)
- **\`sha512_file()\`** - Calculate SHA512 hash of file (extended)
- **\`md2_file()\`** - Calculate MD2 hash of file (extended)
- **\`md4_file()\`** - Calculate MD4 hash of file (extended)

### Notes

- Extended algorithms (MD2, MD4, SHA384, SHA512) may not be available on all systems
- All functions return \`null\` on error or invalid input
- File functions return \`null\` if the file cannot be read

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getLogModuleDocumentation(): string {
    return `## Log Module

**System logging functions for ucode scripts**

The log module provides bindings to the POSIX syslog functions as well as OpenWrt specific ulog library functions.

### Usage

**Named import syntax:**
\`\`\`ucode
import { openlog, syslog, LOG_PID, LOG_USER, LOG_ERR } from 'log';

openlog("my-log-ident", LOG_PID, LOG_USER);
syslog(LOG_ERR, "An error occurred!");

// OpenWrt specific ulog functions
import { ulog_open, ulog, ULOG_SYSLOG, LOG_DAEMON, LOG_INFO } from 'log';

ulog_open(ULOG_SYSLOG, LOG_DAEMON, "my-log-ident");
ulog(LOG_INFO, "The current epoch is %d", time());
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as log from 'log';

log.openlog("my-log-ident", log.LOG_PID, log.LOG_USER);
log.syslog(log.LOG_ERR, "An error occurred!");

// OpenWrt specific ulog functions
log.ulog_open(log.ULOG_SYSLOG, log.LOG_DAEMON, "my-log-ident");
log.ulog(log.LOG_INFO, "The current epoch is %d", time());
\`\`\`

### Available Functions

**Standard syslog functions:**
- **\`openlog()\`** - Open connection to system logger
- **\`syslog()\`** - Log a message to the system logger
- **\`closelog()\`** - Close connection to system logger

**OpenWrt ulog functions:**
- **\`ulog_open()\`** - Configure ulog logger
- **\`ulog()\`** - Log a message via ulog mechanism
- **\`ulog_close()\`** - Close ulog logger
- **\`ulog_threshold()\`** - Set ulog priority threshold

**Convenience functions:**
- **\`INFO()\`** - Log with LOG_INFO priority
- **\`NOTE()\`** - Log with LOG_NOTICE priority
- **\`WARN()\`** - Log with LOG_WARNING priority
- **\`ERR()\`** - Log with LOG_ERR priority

### Constants

**Log options:** LOG_PID, LOG_CONS, LOG_NDELAY, LOG_ODELAY, LOG_NOWAIT

**Log facilities:** LOG_AUTH, LOG_AUTHPRIV, LOG_CRON, LOG_DAEMON, LOG_FTP, LOG_KERN, LOG_LPR, LOG_MAIL, LOG_NEWS, LOG_SYSLOG, LOG_USER, LOG_UUCP, LOG_LOCAL0-7

**Log priorities:** LOG_EMERG, LOG_ALERT, LOG_CRIT, LOG_ERR, LOG_WARNING, LOG_NOTICE, LOG_INFO, LOG_DEBUG

**Ulog channels:** ULOG_KMSG, ULOG_STDIO, ULOG_SYSLOG

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getMathModuleDocumentation(): string {
    return `## Math Module

**Mathematical and trigonometric functions for ucode scripts**

The math module provides comprehensive mathematical operations including basic arithmetic, trigonometry, logarithms, and random number generation.

### Usage

**Named import syntax:**
\`\`\`ucode
import { sin, cos, pow, sqrt, abs } from 'math';

let angle = 3.14159 / 4;  // 45 degrees in radians
let x = cos(angle);       // ~0.707
let y = sin(angle);       // ~0.707
let hypotenuse = sqrt(pow(x, 2) + pow(y, 2));  // ~1.0
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as math from 'math';

let angle = 3.14159 / 4;  // 45 degrees in radians
let x = math.cos(angle);  // ~0.707
let y = math.sin(angle);  // ~0.707
let hypotenuse = math.sqrt(math.pow(x, 2) + math.pow(y, 2));  // ~1.0
\`\`\`

### Available Functions

**Basic operations:**
- **\`abs()\`** - Absolute value
- **\`pow()\`** - Exponentiation (x^y)
- **\`sqrt()\`** - Square root

**Trigonometric functions:**
- **\`sin()\`** - Sine (radians)
- **\`cos()\`** - Cosine (radians)
- **\`atan2()\`** - Arc tangent of y/x (radians)

**Logarithmic and exponential:**
- **\`log()\`** - Natural logarithm
- **\`exp()\`** - e raised to the power of x

**Random number generation:**
- **\`rand()\`** - Generate pseudo-random integer
- **\`srand()\`** - Seed the random number generator

**Utility functions:**
- **\`isnan()\`** - Test if value is NaN (not a number)

### Notes

- All trigonometric functions use radians, not degrees
- Functions return NaN for invalid inputs
- \`rand()\` returns integers in range [0, RAND_MAX] (at least 32767)
- \`srand()\` can be used to create reproducible random sequences

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getNl80211ModuleDocumentation(): string {
    return `## NL80211 Module

**WiFi/802.11 networking interface for ucode scripts**

The nl80211 module provides access to the Linux kernel's nl80211 subsystem for managing WiFi interfaces and wireless networking operations.

### Usage

**Named import syntax:**
\`\`\`ucode
import { request, waitfor, listener, error } from 'nl80211';
import { NL80211_CMD_GET_WIPHY, NL80211_CMD_TRIGGER_SCAN } from 'nl80211';

// Request wireless interface information
let result = request(NL80211_CMD_GET_WIPHY, NLM_F_DUMP);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as nl80211 from 'nl80211';

// Trigger a scan and wait for results
let result = nl80211.request(nl80211.NL80211_CMD_TRIGGER_SCAN, nl80211.NLM_F_ACK);
let scanResults = nl80211.waitfor([nl80211.NL80211_CMD_NEW_SCAN_RESULTS], 10000);
\`\`\`

### Available Functions

**Core operations:**
- **\`request()\`** - Send netlink request to nl80211 subsystem
- **\`waitfor()\`** - Wait for specific nl80211 events
- **\`listener()\`** - Create event listener for nl80211 messages
- **\`error()\`** - Get last error information

### Available Constants

**Netlink flags:**
- **NLM_F_*** - Request flags (ACK, DUMP, CREATE, etc.)

**NL80211 commands:**
- **NL80211_CMD_*** - WiFi interface commands (GET_WIPHY, TRIGGER_SCAN, etc.)

**Interface types:**
- **NL80211_IFTYPE_*** - WiFi interface types (STATION, AP, MONITOR, etc.)

**Hardware simulator:**
- **HWSIM_CMD_*** - Commands for mac80211_hwsim testing

### Notes

- Requires root privileges or appropriate capabilities
- Used for WiFi interface management, scanning, and monitoring
- Integrates with OpenWrt's wireless configuration system
- Event-driven architecture for asynchronous operations

*Hover over individual function names and constants for detailed parameter and return type information.*`;
}

function getResolvModuleDocumentation(): string {
    return `## Resolv Module

**DNS resolution functionality for ucode scripts**

The resolv module provides DNS resolution functionality for ucode, allowing you to perform DNS queries for various record types and handle responses.

### Usage

**Named import syntax:**
\`\`\`ucode
import { query, error } from 'resolv';

let result = query('example.com', { type: ['A'] });
if (!result) {
    let err = error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as resolv from 'resolv';

let result = resolv.query('example.com', { type: ['A'] });
if (!result) {
    let err = resolv.error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

### Available Functions

**Core operations:**
- **\`query()\`** - Perform DNS queries for specified domain names
- **\`error()\`** - Get the last error message from DNS operations

### Supported DNS Record Types

- **A** - IPv4 address record
- **AAAA** - IPv6 address record
- **CNAME** - Canonical name record
- **MX** - Mail exchange record
- **NS** - Name server record
- **PTR** - Pointer record (reverse DNS)
- **SOA** - Start of authority record
- **SRV** - Service record
- **TXT** - Text record
- **ANY** - Any available record type

### Response Codes

- **NOERROR** - Query successful
- **FORMERR** - Format error in query
- **SERVFAIL** - Server failure
- **NXDOMAIN** - Non-existent domain
- **NOTIMP** - Not implemented
- **REFUSED** - Query refused
- **TIMEOUT** - Query timed out

### Examples

Basic A record lookup:
\`\`\`ucode
const result = query(['example.com']);
\`\`\`

Specific record type query:
\`\`\`ucode
const mxRecords = query(['example.com'], { type: ['MX'] });
\`\`\`

Multiple domains with custom nameserver:
\`\`\`ucode
const results = query(['example.com', 'google.com'], {
    type: ['A', 'MX'],
    nameserver: ['8.8.8.8', '1.1.1.1'],
    timeout: 10000
});
\`\`\`

Reverse DNS lookup:
\`\`\`ucode
const ptrResult = query(['192.0.2.1'], { type: ['PTR'] });
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getSocketModuleDocumentation(): string {
    return `## Socket Module

**Network socket functionality for ucode scripts**

The socket module provides comprehensive network socket functionality for creating TCP/UDP connections, listening for incoming connections, and handling network communication.

### Usage

**Named import syntax:**
\`\`\`ucode
import { create, connect, listen, AF_INET, SOCK_STREAM } from 'socket';

// Create a TCP socket
let sock = create(AF_INET, SOCK_STREAM);
let result = connect(sock, "192.168.1.1", "80");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as socket from 'socket';

// Create a UDP socket
let sock = socket.create(socket.AF_INET, socket.SOCK_DGRAM);
let result = socket.connect(sock, "8.8.8.8", "53");
\`\`\`

### Available Functions

**Socket creation and connection:**
- **\`create()\`** - Create a new socket with specified domain, type, and protocol
- **\`connect()\`** - Connect socket to a remote address
- **\`listen()\`** - Listen for incoming connections on a socket

**Address resolution:**
- **\`sockaddr()\`** - Create socket address structures
- **\`addrinfo()\`** - Resolve hostnames and service names to addresses
- **\`nameinfo()\`** - Convert addresses back to hostnames

**I/O operations:**
- **\`poll()\`** - Wait for events on multiple sockets

**Error handling:**
- **\`error()\`** - Get socket error information
- **\`strerror()\`** - Convert error codes to human-readable strings

### Socket Constants

**Address Families:**
- **AF_INET** - IPv4 Internet protocols
- **AF_INET6** - IPv6 Internet protocols  
- **AF_UNIX** - Unix domain sockets

**Socket Types:**
- **SOCK_STREAM** - TCP (reliable, connection-oriented)
- **SOCK_DGRAM** - UDP (unreliable, connectionless)
- **SOCK_RAW** - Raw sockets

**Socket Options:**
- **SOL_SOCKET**, **SO_REUSEADDR**, **SO_KEEPALIVE**, etc.

**Message Flags:**
- **MSG_DONTWAIT**, **MSG_NOSIGNAL**, **MSG_PEEK**, etc.

**Protocols:**
- **IPPROTO_TCP**, **IPPROTO_UDP**, **IPPROTO_IP**, etc.

**Poll Events:**
- **POLLIN**, **POLLOUT**, **POLLERR**, **POLLHUP**, etc.

### Examples

Create and connect TCP socket:
\`\`\`ucode
let sock = create(AF_INET, SOCK_STREAM);
if (connect(sock, "example.com", "80") == 0) {
    print("Connected successfully\\n");
}
\`\`\`

Create UDP server:
\`\`\`ucode
let sock = create(AF_INET, SOCK_DGRAM);
listen(sock, "0.0.0.0", "8080");
\`\`\`

Wait for socket events:
\`\`\`ucode
let result = poll([{fd: sock, events: POLLIN}], 5000);
\`\`\`

*Hover over individual function names and constants for detailed parameter and return type information.*`;
}