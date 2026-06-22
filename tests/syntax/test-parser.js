// Unit test for parser AST node creation and validation

// Mock AST node types
const NodeType = {
    PROGRAM: 'Program',
    VARIABLE_DECLARATION: 'VariableDeclaration',
    FUNCTION_DECLARATION: 'FunctionDeclaration',
    IDENTIFIER: 'Identifier',
    LITERAL: 'Literal',
    MEMBER_EXPRESSION: 'MemberExpression',
    CALL_EXPRESSION: 'CallExpression',
    BLOCK_STATEMENT: 'BlockStatement',
    IF_STATEMENT: 'IfStatement',
    FOR_STATEMENT: 'ForStatement'
};

// Mock parser functions
function mockParseVariableDeclaration(kind, name, value) {
    return {
        type: NodeType.VARIABLE_DECLARATION,
        kind: kind, // 'let', 'const', 'var'
        declarations: [{
            type: 'VariableDeclarator',
            id: {
                type: NodeType.IDENTIFIER,
                name: name
            },
            init: value ? {
                type: NodeType.LITERAL,
                value: value,
                raw: typeof value === 'string' ? `"${value}"` : String(value)
            } : null
        }]
    };
}

function mockParseFunctionDeclaration(name, params, body) {
    return {
        type: NodeType.FUNCTION_DECLARATION,
        id: {
            type: NodeType.IDENTIFIER,
            name: name
        },
        params: params.map(param => ({
            type: NodeType.IDENTIFIER,
            name: param
        })),
        body: {
            type: NodeType.BLOCK_STATEMENT,
            body: body || []
        }
    };
}

function mockParseMemberExpression(object, property, computed = false) {
    return {
        type: NodeType.MEMBER_EXPRESSION,
        object: {
            type: NodeType.IDENTIFIER,
            name: object
        },
        property: {
            type: NodeType.IDENTIFIER,
            name: property
        },
        computed: computed
    };
}

function mockParseCallExpression(callee, args) {
    return {
        type: NodeType.CALL_EXPRESSION,
        callee: typeof callee === 'string' ? {
            type: NodeType.IDENTIFIER,
            name: callee
        } : callee,
        arguments: args.map(arg => ({
            type: NodeType.LITERAL,
            value: arg,
            raw: typeof arg === 'string' ? `"${arg}"` : String(arg)
        }))
    };
}

// Test cases for parser functionality
const testCases = [
    {
        name: "variable declaration parsing (let x = 42)",
        parseFunction: () => mockParseVariableDeclaration('let', 'x', 42),
        expectedType: NodeType.VARIABLE_DECLARATION,
        expectedProperties: {
            kind: 'let',
            declarations: 1,
            identifierName: 'x',
            initValue: 42
        },
        description: "Should parse let variable declaration with number literal"
    },
    {
        name: "constant declaration parsing (const name = 'hello')",
        parseFunction: () => mockParseVariableDeclaration('const', 'name', 'hello'),
        expectedType: NodeType.VARIABLE_DECLARATION,
        expectedProperties: {
            kind: 'const',
            declarations: 1,
            identifierName: 'name',
            initValue: 'hello'
        },
        description: "Should parse const declaration with string literal"
    },
    {
        name: "function declaration parsing (function greet(person))",
        parseFunction: () => mockParseFunctionDeclaration('greet', ['person'], []),
        expectedType: NodeType.FUNCTION_DECLARATION,
        expectedProperties: {
            functionName: 'greet',
            paramCount: 1,
            paramName: 'person',
            hasBody: true
        },
        description: "Should parse function declaration with parameters"
    },
    {
        name: "member expression parsing (obj.property)",
        parseFunction: () => mockParseMemberExpression('obj', 'property'),
        expectedType: NodeType.MEMBER_EXPRESSION,
        expectedProperties: {
            objectName: 'obj',
            propertyName: 'property',
            computed: false
        },
        description: "Should parse member expression correctly"
    },
    {
        name: "function call parsing (print('hello'))",
        parseFunction: () => mockParseCallExpression('print', ['hello']),
        expectedType: NodeType.CALL_EXPRESSION,
        expectedProperties: {
            calleeName: 'print',
            argCount: 1,
            firstArg: 'hello'
        },
        description: "Should parse function call with arguments"
    }
];

function testParserFunctionality(testName, parseFunction, expectedType, expectedProperties) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let ast = null;
    let parseSuccess = false;
    
    try {
        ast = parseFunction();
        parseSuccess = true;
    } catch (error) {
        console.log(`  Parse error: ${error.message}`);
        return false;
    }
    
    // Check AST node type
    const typeCorrect = ast && ast.type === expectedType;
    
    // Validate specific properties based on node type
    let propertiesValid = true;
    const validationResults = {};
    
    if (ast) {
        switch (expectedType) {
            case NodeType.VARIABLE_DECLARATION:
                validationResults.kind = ast.kind === expectedProperties.kind;
                validationResults.declarations = ast.declarations && ast.declarations.length === expectedProperties.declarations;
                validationResults.identifier = ast.declarations?.[0]?.id?.name === expectedProperties.identifierName;
                validationResults.initValue = ast.declarations?.[0]?.init?.value === expectedProperties.initValue;
                break;
                
            case NodeType.FUNCTION_DECLARATION:
                validationResults.functionName = ast.id?.name === expectedProperties.functionName;
                validationResults.paramCount = ast.params?.length === expectedProperties.paramCount;
                validationResults.paramName = ast.params?.[0]?.name === expectedProperties.paramName;
                validationResults.hasBody = ast.body?.type === NodeType.BLOCK_STATEMENT;
                break;
                
            case NodeType.MEMBER_EXPRESSION:
                validationResults.objectName = ast.object?.name === expectedProperties.objectName;
                validationResults.propertyName = ast.property?.name === expectedProperties.propertyName;
                validationResults.computed = ast.computed === expectedProperties.computed;
                break;
                
            case NodeType.CALL_EXPRESSION:
                validationResults.calleeName = ast.callee?.name === expectedProperties.calleeName;
                validationResults.argCount = ast.arguments?.length === expectedProperties.argCount;
                validationResults.firstArg = ast.arguments?.[0]?.value === expectedProperties.firstArg;
                break;
        }
        
        propertiesValid = Object.values(validationResults).every(valid => valid);
    }
    
    const result = parseSuccess && typeCorrect && propertiesValid;
    
    console.log(`  Parse success: ${parseSuccess ? '✅' : '❌'}`);
    console.log(`  Type correct: ${typeCorrect ? '✅' : '❌'} (expected: ${expectedType}, got: ${ast?.type || 'none'})`);
    console.log(`  Properties valid: ${propertiesValid ? '✅' : '❌'}`);
    
    if (!propertiesValid) {
        Object.entries(validationResults).forEach(([prop, valid]) => {
            console.log(`    ${prop}: ${valid ? '✅' : '❌'}`);
        });
    }
    
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing Parser AST Node Creation...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testParserFunctionality(
        testCase.name, 
        testCase.parseFunction, 
        testCase.expectedType, 
        testCase.expectedProperties
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All parser AST node creation tests passed!');
} else {
    console.log('❌ Some tests failed. Check parser logic.');
}

console.log('\n💡 Note: These test the parser AST node creation patterns for ucode syntax.');
console.log('💡 Proper AST generation is essential for semantic analysis and diagnostics.');