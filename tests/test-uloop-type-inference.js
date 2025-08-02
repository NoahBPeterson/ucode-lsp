// Test to verify uloop object type inference works correctly
const assert = require('assert');
const { UcodeLexer } = require('../out/lexer/ucodeLexer');
const { UcodeParser } = require('../out/parser/ucodeParser');
const { SemanticAnalyzer } = require('../out/analysis/semanticAnalyzer');

describe('Uloop Type Inference Tests', () => {
    let analyzer;

    beforeEach(() => {
        analyzer = new SemanticAnalyzer();
    });

    it('should infer correct type for uloop.signal() assignment', () => {
        const code = `
            import * as uloop from 'uloop';
            let toSignal = uloop.signal("SIGUSR1", () => {
                printf("SIGUSR1 received!\\n");
            });
        `;

        const lexer = new UcodeLexer(code);
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const result = analyzer.analyze(ast);

        // Look up the toSignal symbol in the symbol table
        const symbol = result.symbolTable.lookup('toSignal');
        
        assert(symbol, 'toSignal symbol should exist in symbol table');
        assert(typeof symbol.dataType === 'object', 'toSignal should have object dataType');
        assert(symbol.dataType.type === 'object', 'toSignal should have object type');
        assert(symbol.dataType.moduleName === 'uloop.signal', 'toSignal should have moduleName "uloop.signal"');
        
        console.log('✅ toSignal dataType:', JSON.stringify(symbol.dataType));
    });

    it('should infer correct type for uloop.timer() assignment', () => {
        const code = `
            import * as uloop from 'uloop';
            let timer = uloop.timer(1000, () => {});
        `;

        const lexer = new UcodeLexer(code);
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const result = analyzer.analyze(ast);

        const symbol = result.symbolTable.lookup('timer');
        
        assert(symbol, 'timer symbol should exist in symbol table');
        assert(typeof symbol.dataType === 'object', 'timer should have object dataType');
        assert(symbol.dataType.type === 'object', 'timer should have object type');
        assert(symbol.dataType.moduleName === 'uloop.timer', 'timer should have moduleName "uloop.timer"');
        
        console.log('✅ timer dataType:', JSON.stringify(symbol.dataType));
    });

    it('should infer correct type for uloop.handle() assignment', () => {
        const code = `
            import * as uloop from 'uloop';
            import * as fs from 'fs';
            let file = fs.open("/dev/null", "r");
            let handle = uloop.handle(file, () => {}, uloop.ULOOP_READ);
        `;

        const lexer = new UcodeLexer(code);
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const result = analyzer.analyze(ast);

        const symbol = result.symbolTable.lookup('handle');
        
        assert(symbol, 'handle symbol should exist in symbol table');
        assert(typeof symbol.dataType === 'object', 'handle should have object dataType');
        assert(symbol.dataType.type === 'object', 'handle should have object type');
        assert(symbol.dataType.moduleName === 'uloop.handle', 'handle should have moduleName "uloop.handle"');
        
        console.log('✅ handle dataType:', JSON.stringify(symbol.dataType));
    });

    it('should infer correct type for uloop.process() assignment', () => {
        const code = `
            import * as uloop from 'uloop';
            let process = uloop.process("/bin/echo", ["hello"], {}, () => {});
        `;

        const lexer = new UcodeLexer(code);
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const result = analyzer.analyze(ast);

        const symbol = result.symbolTable.lookup('process');
        
        assert(symbol, 'process symbol should exist in symbol table');
        assert(typeof symbol.dataType === 'object', 'process should have object dataType');
        assert(symbol.dataType.type === 'object', 'process should have object type');
        assert(symbol.dataType.moduleName === 'uloop.process', 'process should have moduleName "uloop.process"');
        
        console.log('✅ process dataType:', JSON.stringify(symbol.dataType));
    });

    it('should verify uloopObjectRegistry recognizes the types correctly', () => {
        const { uloopObjectRegistry } = require('../out/analysis/uloopTypes');
        
        // Test the type detection logic
        const signalDataType = { type: 'object', moduleName: 'uloop.signal' };
        const timerDataType = { type: 'object', moduleName: 'uloop.timer' };
        const handleDataType = { type: 'object', moduleName: 'uloop.handle' };
        const processDataType = { type: 'object', moduleName: 'uloop.process' };
        
        const signalType = uloopObjectRegistry.isVariableOfUloopType(signalDataType);
        const timerType = uloopObjectRegistry.isVariableOfUloopType(timerDataType);
        const handleType = uloopObjectRegistry.isVariableOfUloopType(handleDataType);
        const processType = uloopObjectRegistry.isVariableOfUloopType(processDataType);
        
        assert.strictEqual(signalType, 'uloop.signal', 'Should detect uloop.signal type');
        assert.strictEqual(timerType, 'uloop.timer', 'Should detect uloop.timer type');
        assert.strictEqual(handleType, 'uloop.handle', 'Should detect uloop.handle type');
        assert.strictEqual(processType, 'uloop.process', 'Should detect uloop.process type');
        
        console.log('✅ uloopObjectRegistry type detection working correctly');
    });

    it('should provide methods for detected uloop types', () => {
        const { uloopObjectRegistry } = require('../out/analysis/uloopTypes');
        
        const signalMethods = uloopObjectRegistry.getMethodsForType('uloop.signal');
        const timerMethods = uloopObjectRegistry.getMethodsForType('uloop.timer');
        const handleMethods = uloopObjectRegistry.getMethodsForType('uloop.handle');
        
        assert(signalMethods.includes('signo'), 'Signal should have signo method');
        assert(signalMethods.includes('delete'), 'Signal should have delete method');
        
        assert(timerMethods.includes('set'), 'Timer should have set method');
        assert(timerMethods.includes('remaining'), 'Timer should have remaining method');
        assert(timerMethods.includes('cancel'), 'Timer should have cancel method');
        
        assert(handleMethods.includes('fileno'), 'Handle should have fileno method');
        assert(handleMethods.includes('handle'), 'Handle should have handle method');
        assert(handleMethods.includes('delete'), 'Handle should have delete method');
        
        console.log('✅ Signal methods:', signalMethods);
        console.log('✅ Timer methods:', timerMethods);
        console.log('✅ Handle methods:', handleMethods);
    });
});