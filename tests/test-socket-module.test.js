// Test suite for socket module registry (bun test)
import { test, expect, describe } from 'bun:test';
import { socketTypeRegistry } from '../src/analysis/socketTypes';

const expectedFunctions = [
  'create', 'connect', 'listen', 'sockaddr', 'nameinfo', 'addrinfo', 'poll', 'error', 'strerror'
];

describe('Socket Module Registry', () => {
  test('all expected functions are present', () => {
    const actualFunctions = socketTypeRegistry.getFunctionNames();
    for (const name of expectedFunctions) {
      expect(actualFunctions).toContain(name);
    }
  });

  test('all registered constants have documentation', () => {
    const actualConstants = socketTypeRegistry.getConstantNames();
    expect(actualConstants.length).toBeGreaterThan(0);
    for (const name of actualConstants) {
      const doc = socketTypeRegistry.getConstantDocumentation(name);
      expect(doc?.length).toBeGreaterThan(0);
    }
  });

  test('function signature formatting', () => {
    const createSig = socketTypeRegistry.formatFunctionSignature('create');
    expect(createSig).toBe('create([domain: number] = AF_INET, [type: number] = SOCK_STREAM, [protocol: number] = 0): socket | null');
  });

  test('function documentation generation', () => {
    const createDoc = socketTypeRegistry.getFunctionDocumentation('create');
    expect(createDoc).toContain('Creates a network socket instance');
    expect(createDoc).toContain('**Parameters:**');
    expect(createDoc).toContain('**Returns:**');
  });

  test('constant documentation generation', () => {
    const afInetDoc = socketTypeRegistry.getConstantDocumentation('AF_INET');
    expect(afInetDoc).toContain('AF_INET');
    expect(afInetDoc).toContain('IPv4 Internet protocols');
    expect(afInetDoc).toContain('number');
  });

  test('function parameter handling', () => {
    const connectFunc = socketTypeRegistry.getFunction('connect');
    expect(connectFunc).toBeTruthy();
    expect(connectFunc.parameters.length).toBeGreaterThanOrEqual(3);
    expect(connectFunc.parameters[0].name).toBe('host');
    expect(connectFunc.parameters[0].optional).toBe(false);
    expect(connectFunc.parameters[1].name).toBe('service');
    expect(connectFunc.parameters[1].optional).toBe(true);
  });

  test('function identification', () => {
    expect(socketTypeRegistry.isSocketFunction('create')).toBe(true);
    expect(socketTypeRegistry.isSocketFunction('connect')).toBe(true);
    expect(socketTypeRegistry.isSocketFunction('nonexistent')).toBe(false);
  });

  test('constant identification', () => {
    expect(socketTypeRegistry.isSocketConstant('AF_INET')).toBe(true);
    expect(socketTypeRegistry.isSocketConstant('SOCK_STREAM')).toBe(true);
    expect(socketTypeRegistry.isSocketConstant('NONEXISTENT_CONST')).toBe(false);
  });

  test('return type handling', () => {
    const createFunc = socketTypeRegistry.getFunction('create');
    expect(createFunc.returnType).toBe('socket | null');
    const errorFunc = socketTypeRegistry.getFunction('error');
    expect(errorFunc.returnType).toBe('string | number | null');
  });

  test('import validation', () => {
    expect(socketTypeRegistry.isValidImport('create')).toBe(true);
    expect(socketTypeRegistry.isValidImport('AF_INET')).toBe(true);
    expect(socketTypeRegistry.isValidImport('invalid_import')).toBe(false);
    const validImports = socketTypeRegistry.getValidImports();
    const actualConstants = socketTypeRegistry.getConstantNames();
    expect(validImports.length).toBe(expectedFunctions.length + actualConstants.length);
  });

  test('optional parameter handling with defaults', () => {
    const listenFunc = socketTypeRegistry.getFunction('listen');
    expect(listenFunc).toBeTruthy();
    const backlogParam = listenFunc.parameters.find(p => p.name === 'backlog');
    expect(backlogParam).toBeTruthy();
    expect(backlogParam.optional).toBe(true);
    expect(backlogParam.defaultValue).toBe(128);
  });

  test('complex type signatures', () => {
    const connectFunc = socketTypeRegistry.getFunction('connect');
    expect(connectFunc.parameters[0].type).toContain('string | number[] | SocketAddress');
  });

  test('mock completion integration', () => {
    const functionNames = socketTypeRegistry.getFunctionNames();
    const constantNames = socketTypeRegistry.getConstantNames();
    expect(functionNames).toContain('create');
    expect(constantNames).toContain('AF_INET');
  });

  test('documentation formatting consistency', () => {
    const createDoc = socketTypeRegistry.getFunctionDocumentation('create');
    const connectDoc = socketTypeRegistry.getFunctionDocumentation('connect');
    expect(createDoc).toContain('**Parameters:**');
    expect(createDoc).toContain('**Returns:**');
    expect(connectDoc).toContain('**Parameters:**');
    expect(connectDoc).toContain('**Returns:**');
  });

  test('constant value types', () => {
    const afInet = socketTypeRegistry.getConstant('AF_INET');
    expect(typeof afInet.value).toBe('number');
    expect(afInet.type).toBe('number');
    const sockStream = socketTypeRegistry.getConstant('SOCK_STREAM');
    expect(typeof sockStream.value).toBe('number');
    expect(sockStream.type).toBe('number');
  });
});
