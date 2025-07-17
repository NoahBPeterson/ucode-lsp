// Debug member expression detection
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { TokenType } from '../src/lexer/tokenTypes.ts';

console.log('🔍 Debugging Member Expression Detection\n');

const documentText = `let file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.write("lol");`;

console.log('📄 Document Text:');
console.log(documentText);
console.log('\n' + '='.repeat(50));

// Test different cursor positions
const testPositions = [
    { line: 1, character: 12, description: 'Before dot' },      // file_content|.write
    { line: 1, character: 13, description: 'After dot' },       // file_content.|write  
    { line: 1, character: 14, description: 'After w' },         // file_content.w|rite
    { line: 1, character: 17, description: 'After write' },     // file_content.write|
];

const document = {
    offsetAt: (position) => {
        const lines = documentText.split('\n');
        let offset = 0;
        for (let i = 0; i < position.line; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        offset += position.character;
        return offset;
    }
};

// Copy the member detection function from completion.ts
function detectMemberCompletionContext(offset, tokens) {
    let dotTokenIndex = -1;
    
    // Find the most recent DOT token before or at the cursor
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.type === TokenType.TK_DOT && token.pos < offset) {
            dotTokenIndex = i;
            break;
        }
    }
    
    // If we found a dot, check if there's a LABEL token immediately before it
    if (dotTokenIndex > 0) {
        const dotToken = tokens[dotTokenIndex];
        const prevToken = tokens[dotTokenIndex - 1];
        
        // Check if previous token is a LABEL and it's immediately before the dot
        if (prevToken.type === TokenType.TK_LABEL && prevToken.end === dotToken.pos) {
            // Make sure the cursor is after the dot (for completion)
            if (offset > dotToken.end) {
                return {
                    objectName: prevToken.value
                };
            }
        }
    }
    
    return undefined;
}

try {
    const lexer = new UcodeLexer(documentText, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('🔤 TOKENS:');
    tokens.forEach((token, index) => {
        if (index < 20) { // Show first 20 tokens
            console.log(`${index}: ${token.type} = "${token.value}" (pos: ${token.pos}-${token.end})`);
        }
    });
    
    console.log('\n🧪 TESTING MEMBER DETECTION:');
    
    testPositions.forEach(pos => {
        const offset = document.offsetAt(pos);
        const char = documentText[offset] || '<EOF>';
        const context = documentText.substring(Math.max(0, offset - 5), offset + 5);
        
        console.log(`\n📍 ${pos.description}: line ${pos.line}, char ${pos.character}`);
        console.log(`   Offset: ${offset}`);
        console.log(`   Character at offset: "${char}"`);
        console.log(`   Context: "${context}"`);
        
        const result = detectMemberCompletionContext(offset, tokens);
        if (result) {
            console.log(`   ✅ Member detected: ${result.objectName}`);
        } else {
            console.log(`   ❌ No member detected`);
        }
        
        // Show relevant tokens around this offset
        console.log(`   Relevant tokens:`);
        tokens.forEach((token, index) => {
            if (Math.abs(token.pos - offset) <= 10) {
                const marker = (token.pos <= offset && offset <= token.end) ? ' <<< CURSOR' : '';
                console.log(`     ${index}: ${token.type} = "${token.value}" (${token.pos}-${token.end})${marker}`);
            }
        });
    });
    
} catch (error) {
    console.log(`❌ Error: ${error.message}`);
    console.log(error.stack);
}