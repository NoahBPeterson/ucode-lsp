// Debug enum values
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('Token type mappings:');
console.log('TK_EXPORT:', TokenType.TK_EXPORT);
console.log('TK_DEC:', TokenType.TK_DEC);
console.log('TK_PACKAGE:', TokenType.TK_PACKAGE);
console.log('TK_EOF:', TokenType.TK_EOF);

// Check keywords mapping
const { Keywords } = require('../src/lexer/tokenTypes.ts');
console.log('\nKeywords mapping:');
console.log('export:', Keywords['export']);
console.log('TK_EXPORT value:', TokenType.TK_EXPORT);