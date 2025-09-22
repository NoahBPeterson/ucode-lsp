import { test, expect } from 'bun:test';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { debugTypeRegistry } from '../src/analysis/debugTypes.ts';
import { digestTypeRegistry } from '../src/analysis/digestTypes.ts';
import { logTypeRegistry } from '../src/analysis/logTypes.ts';
import { mathTypeRegistry } from '../src/analysis/mathTypes.ts';
import { nl80211TypeRegistry } from '../src/analysis/nl80211Types.ts';
import { resolvTypeRegistry } from '../src/analysis/resolvTypes.ts';
import { socketTypeRegistry } from '../src/analysis/socketTypes.ts';
import { structTypeRegistry } from '../src/analysis/structTypes.ts';
import { ubusTypeRegistry } from '../src/analysis/ubusTypes.ts';
import { uciTypeRegistry } from '../src/analysis/uciTypes.ts';
import { uloopTypeRegistry } from '../src/analysis/uloopTypes.ts';
import { zlibTypeRegistry } from '../src/analysis/zlibTypes.ts';

function parseAndAnalyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens);
  const parseResult = parser.parse();

  const document = TextDocument.create('test://module-method.uc', 'ucode', 1, code);
  const analyzer = new SemanticAnalyzer(document, {
    enableScopeAnalysis: true,
    enableTypeChecking: true,
    enableUnusedVariableDetection: false,
    enableShadowingWarnings: false,
  });

  const result = analyzer.analyze(parseResult.ast);
  return result.diagnostics;
}

const moduleConfigs = [
  { name: 'debug', getFunctions: () => debugTypeRegistry.getFunctionNames() },
  { name: 'digest', getFunctions: () => digestTypeRegistry.getFunctionNames() },
  { name: 'log', getFunctions: () => logTypeRegistry.getFunctionNames() },
  { name: 'math', getFunctions: () => mathTypeRegistry.getFunctionNames() },
  { name: 'nl80211', getFunctions: () => nl80211TypeRegistry.getFunctionNames() },
  { name: 'resolv', getFunctions: () => resolvTypeRegistry.getFunctionNames() },
  { name: 'socket', getFunctions: () => socketTypeRegistry.getFunctionNames() },
  { name: 'struct', getFunctions: () => structTypeRegistry.getFunctionNames() },
  { name: 'ubus', getFunctions: () => ubusTypeRegistry.getFunctionNames() },
  { name: 'uci', getFunctions: () => uciTypeRegistry.getFunctionNames() },
  { name: 'uloop', getFunctions: () => uloopTypeRegistry.getFunctionNames() },
  { name: 'zlib', getFunctions: () => zlibTypeRegistry.getFunctionNames() },
];

for (const { name: moduleName, getFunctions } of moduleConfigs) {
  const functions = getFunctions();
  if (functions.length === 0) {
    continue;
  }

  const alias = `mod_${moduleName.replace(/[^a-zA-Z0-9_]/g, '')}`;
  const invalidMethod = '__not_a_real_function__';

  test(`${moduleName} module validation - invalid namespace methods are rejected`, () => {
    const code = `
'use strict';

import * as ${alias} from '${moduleName}';

export function test() {
  ${alias}.${invalidMethod}();
}`;

    const diagnostics = parseAndAnalyze(code);
    const moduleDiagnostics = diagnostics.filter(
      (d) =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes(`not available on the ${moduleName} module`)
    );

    if (moduleDiagnostics.length !== 1) {
      console.log(`Unexpected diagnostics for module '${moduleName}':`, diagnostics);
    }

    expect(moduleDiagnostics.length).toBe(1);
    expect(moduleDiagnostics[0].message.includes(invalidMethod)).toBe(true);
  });
}
