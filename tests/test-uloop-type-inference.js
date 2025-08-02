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

    it('should provide hover information for delete() methods on uloop objects', () => {
        // Test the uloop object registry directly to verify delete methods exist
        const { uloopObjectRegistry } = require('../out/analysis/uloopTypes');
        
        // Test that delete methods are properly defined for each uloop object type
        const handleDeleteMethod = uloopObjectRegistry.getUloopMethod('uloop.handle', 'delete');
        const processDeleteMethod = uloopObjectRegistry.getUloopMethod('uloop.process', 'delete');
        const signalDeleteMethod = uloopObjectRegistry.getUloopMethod('uloop.signal', 'delete');

        assert(handleDeleteMethod, 'handle.delete() method should be defined');
        assert(processDeleteMethod, 'process.delete() method should be defined');  
        assert(signalDeleteMethod, 'signal.delete() method should be defined');

        assert(handleDeleteMethod.name === 'delete', 'handle delete method name should be "delete"');
        assert(handleDeleteMethod.description.includes('Unregisters the uloop handle'), 'handle delete should have correct description');
        assert(handleDeleteMethod.returnType === 'null', 'handle delete should return null');

        assert(processDeleteMethod.name === 'delete', 'process delete method name should be "delete"');
        assert(processDeleteMethod.description.includes('Unregisters the process'), 'process delete should have correct description');
        assert(processDeleteMethod.returnType === 'boolean', 'process delete should return boolean');

        assert(signalDeleteMethod.name === 'delete', 'signal delete method name should be "delete"');
        assert(signalDeleteMethod.description.includes('Uninstalls the signal handler'), 'signal delete should have correct description');
        assert(signalDeleteMethod.returnType === 'boolean', 'signal delete should return boolean');

        console.log('✅ Handle delete() method:', handleDeleteMethod.description);
        console.log('✅ Process delete() method:', processDeleteMethod.description);
        console.log('✅ Signal delete() method:', signalDeleteMethod.description);
    });

    it('should infer correct return types for uloop method calls', () => {
        const code = `
            import * as uloop from 'uloop';
            let handle = uloop.handle(3, () => {}, uloop.ULOOP_READ);
            let process = uloop.process("/bin/sleep", ["1"], {}, (exitCode) => {});
            let signal = uloop.signal("SIGUSR1", () => {});
            
            let fd = handle.fileno();
            let fileHandle = handle.handle();
            let pid = process.pid();
            let signo = signal.signo();
        `;

        const lexer = new UcodeLexer(code);
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const result = analyzer.analyze(ast);

        // Check that variables assigned from method calls have proper types
        const fdSymbol = result.symbolTable.lookup('fd');
        const fileHandleSymbol = result.symbolTable.lookup('fileHandle');
        const pidSymbol = result.symbolTable.lookup('pid');  
        const signoSymbol = result.symbolTable.lookup('signo');

        assert(fdSymbol, 'fd symbol should exist');
        assert(pidSymbol, 'pid symbol should exist');
        assert(signoSymbol, 'signo symbol should exist');
        assert(fileHandleSymbol, 'fileHandle symbol should exist');

        // fd, pid, signo should be integers (not "unknown")
        assert(fdSymbol.dataType === 'integer' || fdSymbol.dataType === 'number', 'fd should have integer type');
        assert(pidSymbol.dataType === 'integer' || pidSymbol.dataType === 'number', 'pid should have integer type');
        assert(signoSymbol.dataType === 'integer' || signoSymbol.dataType === 'number', 'signo should have integer type');
        
        // fileHandle should have fs.file type for autocomplete
        assert(typeof fileHandleSymbol.dataType === 'object', 'fileHandle should have object dataType');
        assert(fileHandleSymbol.dataType.moduleName === 'fs.file', 'fileHandle should have fs.file type');

        console.log('✅ fd type:', fdSymbol.dataType);
        console.log('✅ pid type:', pidSymbol.dataType);
        console.log('✅ signo type:', signoSymbol.dataType);
        console.log('✅ fileHandle type:', JSON.stringify(fileHandleSymbol.dataType));
    });
});