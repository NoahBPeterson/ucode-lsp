const { spawn } = require('child_process');
const assert = require('assert');
const { errorMonitor } = require('events');

async function runTests() {
  let serverProcess;
  let requestId = 1;
  let buffer = '';
  let pendingRequests = new Map();

  function createLSPMessage(obj) {
    const content = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
  }

  function getDiagnostics(testContent, testFilePath) {
    return new Promise((resolve, reject) => {
      const uri = `file://${testFilePath}`;
      const didOpen = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri, languageId: 'ucode', version: 1, text: testContent } }
      };
      const timeout = setTimeout(() => {
        if (pendingRequests.has(uri)) {
          pendingRequests.delete(uri);
          reject(new Error('Timeout waiting for diagnostics'));
        }
      }, 8000);
      pendingRequests.set(uri, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  try {
    serverProcess = spawn('node', ['dist/server.js', '--stdio'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    serverProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = buffer.slice(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length: (\d+)/);
        if (!contentLengthMatch) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const contentLength = parseInt(contentLengthMatch[1]);
        const messageStart = headerEnd + 4;
        if (buffer.length < messageStart + contentLength) break;
        const messageContent = buffer.slice(messageStart, messageStart + contentLength);
        buffer = buffer.slice(messageStart + contentLength);
        try {
          const message = JSON.parse(messageContent);
          if (message.method === 'textDocument/publishDiagnostics') {
            const uri = message.params.uri;
            if (pendingRequests.has(uri)) {
              const { resolve, timeout } = pendingRequests.get(uri);
              clearTimeout(timeout);
              pendingRequests.delete(uri);
              resolve(message.params.diagnostics);
            }
          }
          if (message.id && pendingRequests.has(message.id)) {
            const { resolve, timeout } = pendingRequests.get(message.id);
            clearTimeout(timeout);
            pendingRequests.delete(message.id);
            resolve(message.result);
          }
        } catch (e) {}
      }
    });

    await new Promise((resolve, reject) => {
        const initialize = {
            jsonrpc: '2.0',
            id: requestId++,
            method: 'initialize',
            params: { processId: process.pid, capabilities: {} }
        };

        pendingRequests.set(initialize.id, {
            resolve: () => {
                serverProcess.stdin.write(createLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
                resolve();
            },
            timeout: setTimeout(() => reject(new Error('Server initialization timeout')), 8000)
        });

        serverProcess.stdin.write(createLSPMessage(initialize));
    });

    const testCases = [
        // wildcard() tests - original tests updated for new validation
        {
            name: 'wildcard() naked POSIX class (should be [[:alpha:]])',
            code: 'wildcard("image.jpeg", "image.[:alpha:]");',
            expectedErrors: 1,
            errorMessage: "POSIX character class used without outer brackets"
        },
        {
            name: 'wildcard() unknown POSIX class',
            code: 'wildcard("image.jpeg", "image.[[:foo:]]");',
            expectedErrors: 1,
            errorMessage: "Unknown POSIX character class"
        },
        {
            name: 'wildcard() unterminated POSIX class',
            code: 'wildcard("text.txt", "text.[[:alnum]]");',
            expectedErrors: 1,
            errorMessage: "Unterminated character class"
        },
        {
            name: 'wildcard() unclosed bracket',
            code: 'wildcard("archive.zip", "archive.[zip");',
            expectedErrors: 1,
            errorMessage: "Unclosed bracket expression"
        },
        {
            name: 'wildcard() redundant star',
            code: 'wildcard("data.log", "data**log");',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "Redundant '*'"
        },
        {
            name: 'wildcard() trailing backslash literal',
            code: `wildcard("config.json", "config.json\\\\");`,
            expectedWarnings: 2,
            expectedErrors: 0,
            errorMessage: "Trailing backslash escapes nothing"
        },
        {
            name: 'wildcard() no wildcard characters',
            code: 'wildcard("README.md", "README.md");',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "contains no wildcard characters"
        },
        {
            name: 'wildcard() with two valid string arguments',
            code: 'wildcard("test.uc", "*.uc");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with a number as the first argument',
            code: 'wildcard(123, "*.uc");',
            expectedErrors: 0  // Numbers are cast to string, so this is valid
        },
        {
            name: 'wildcard() with an array as the second argument',
            code: 'wildcard("*.uc", []);',
            expectedErrors: 1,
            errorMessage: "Function 'wildcard' expects string for argument 2, but got array"
        },

        // regexp() tests
        {
            name: 'regexp() with one valid string argument',
            code: 'regexp("[a-z]");',
            expectedErrors: 0
        },
        {
            name: 'regexp() with two valid string arguments',
            code: 'regexp("[a-z]", "g");',
            expectedErrors: 0
        },
        {
            name: 'regexp() with a number as the first argument',
            code: 'regexp(456);',
            expectedErrors: 1,
            errorMessage: "Function 'regexp' expects string for argument 1, but got integer"
        },
        {
            name: 'regexp() with an object as the second argument',
            code: 'regexp("[a-z]", {});',
            expectedErrors: 1,
            errorMessage: "Function 'regexp' expects string for argument 2, but got object"
        },
        {
            name: 'regexp() with valid flag "i"',
            code: 'regexp("[a-z]", "i");',
            expectedErrors: 0
        },
        {
            name: 'regexp() with valid flag "s"',
            code: 'regexp("[a-z]", "s");',
            expectedErrors: 0
        },
        {
            name: 'regexp() with valid multiple flags "ig"',
            code: 'regexp("[a-z]", "ig");',
            expectedErrors: 0
        },
        {
            name: 'regexp() with all valid flags "gsi"',
            code: 'regexp("[a-z]", "gsi");',
            expectedErrors: 0
        },
        {
            name: 'regexp() with invalid flag "x"',
            code: 'regexp("[a-z]", "x");',
            expectedErrors: 1,
            errorMessage: "Unrecognized flag characters: 'x'"
        },
        {
            name: 'regexp() with invalid flag "m"',
            code: 'regexp("[a-z]", "m");',
            expectedErrors: 1,
            errorMessage: "Unrecognized flag characters: 'm'"
        },
        {
            name: 'regexp() with multiple invalid flags "xyz"',
            code: 'regexp("[a-z]", "xyz");',
            expectedErrors: 1,
            errorMessage: "Unrecognized flag characters: 'x', 'y', 'z'"
        },
        {
            name: 'regexp() with mixed valid and invalid flags "gx"',
            code: 'regexp("[a-z]", "gx");',
            expectedErrors: 1,
            errorMessage: "Unrecognized flag characters: 'x'"
        },

        // assert() tests
        {
            name: 'assert() with a boolean',
            code: 'assert(true);',
            expectedErrors: 0
        },
        {
            name: 'assert() with a number and a string',
            code: 'assert(1, "message");',
            expectedErrors: 0
        },
        {
            name: 'assert() with no arguments',
            code: 'assert();',
            expectedWarnings: 1,
            errorMessage: "Empty assert() will always fail - consider adding a condition"
        },
        {
            name: 'assert() with false literal',
            code: 'assert(false);',
            expectedWarnings: 1,
            errorMessage: "assert() with falsy value will always fail - consider adding a condition"
        },
        {
            name: 'assert() with zero literal',
            code: 'assert(0);',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "assert() with falsy value will always fail - consider adding a condition"
        },
        {
            name: 'assert() with empty string literal',
            code: 'assert("");',
            expectedErrors: 1,
            errorMessage: "assert() with falsy value will always fail - consider adding a condition"
        },
        {
            name: 'assert() with null literal',
            code: 'assert(null);',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "assert() with falsy value will always fail - consider adding a condition"
        },
        {
            name: 'assert() with zero double literal',
            code: 'assert(0.0);',
            expectedErrors: 1,
            errorMessage: "assert() with falsy value will always fail - consider adding a condition"
        },
        {
            name: 'assert() with non-zero number',
            code: 'assert(1);',
            expectedErrors: 0
        },
        {
            name: 'assert() with non-empty string',
            code: 'assert("hello");',
            expectedErrors: 0
        },
        {
            name: 'assert() with array literal (truthy)',
            code: 'assert([]);',
            expectedErrors: 0
        },
        {
            name: 'assert() with object literal (truthy)',
            code: 'assert({});',
            expectedErrors: 0
        },

        // wildcard() tests - comprehensive validation
        {
            name: 'wildcard() with valid pattern and asterisk',
            code: 'wildcard("file.txt", "*.txt");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with valid pattern and question mark',
            code: 'wildcard("file.txt", "file.???");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with valid bracket expression',
            code: 'wildcard("file.txt", "[a-z]*.txt");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with no wildcard characters',
            code: 'wildcard("file.txt", "file.txt");',
            expectedErrors: 1,
            errorMessage: "contains no wildcard characters"
        },
        {
            name: 'wildcard() with redundant asterisks',
            code: 'wildcard("file.txt", "**/*.txt");',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "Redundant '*' at position 0"
        },
        {
            name: 'wildcard() with trailing backslash',
            code: 'wildcard("file.txt", "*.txt\\\\");',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "Trailing backslash escapes nothing"
        },
        {
            name: 'wildcard() with unclosed bracket',
            code: 'wildcard("file.txt", "[a-z*.txt");',
            expectedErrors: 2,
            errorMessage: "Unclosed bracket expression"
        },
        {
            name: 'wildcard() with hyphen literal',
            code: 'wildcard("file.txt", "[a-].txt");',
            expectedErrors: 0,
        },
        {
            name: 'wildcard() with hyphen literal',
            code: 'wildcard("file.txt", "[-a].txt");',
            expectedErrors: 0,
        },
        {
            name: 'wildcard() with descending range',
            code: 'wildcard("file.txt", "[z-a].txt");',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "Descending range 'z-a'"
        },
        {
            name: 'wildcard() with suspicious range A-z',
            code: 'wildcard("file.txt", "[A-z]*.txt");',
            expectedWarnings: 1,
            expectedErrors: 0,
            errorMessage: "Suspicious range 'A-z' spans punctuation"
        },
        {
            name: 'wildcard() with unknown POSIX class',
            code: 'wildcard("file.txt", "[[:invalid:]]*.txt");',
            expectedErrors: 1,
            errorMessage: "Unknown POSIX character class"
        },
        {
            name: 'wildcard() with valid POSIX class',
            code: 'wildcard("file.txt", "[[:alpha:]]*.txt");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with question mark in brackets',
            code: 'wildcard("file.txt", "[file?]*.txt");',
            expectedErrors: 1,
            errorMessage: "'?' is literal"
        },
        {
            name: 'wildcard() with asterisk in brackets',
            code: 'wildcard("file.txt", "[file*]*.txt");',
            expectedErrors: 1,
            errorMessage: "'*' is literal"
        },
        {
            name: 'wildcard() with unterminated character class',
            code: 'wildcard("file.txt", "[[:alpha]*.txt");',
            expectedErrors: 1,
            errorMessage: "Unterminated character class"
        },
        {
            name: 'wildcard() with unterminated character class',
            code: 'wildcard("file.txt", "[:alpha:]*.txt");',
            expectedErrors: 1,
            errorMessage: "POSIX character class used without outer brackets."
        },
        {
            name: 'wildcard() with non-string pattern',
            code: 'wildcard("file.txt", 123);',
            expectedErrors: 1,
            errorMessage: "expects string for argument 2, but got integer"
        },
        {
            name: 'wildcard() with insufficient arguments',
            code: 'wildcard("file.txt");',
            expectedErrors: 1,
            errorMessage: "expects at least 2 argument(s), got 1"
        },
        {
            name: 'wildcard() with any type first argument (number)',
            code: 'wildcard(123, "*.txt");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with any type first argument (boolean)',
            code: 'wildcard(true, "*.txt");',
            expectedErrors: 0
        },
        {
            name: 'wildcard() with third argument (case insensitive)',
            code: 'wildcard("file.txt", "*.TXT", true);',
            expectedErrors: 0
        }
    ];

    let passed = 0;
    for (const testCase of testCases) {
        const diagnostics = await getDiagnostics(testCase.code, `/tmp/test-${Math.random()}.uc`);
        try {
            if (typeof testCase.expectedWarnings === 'number') {
                assert.strictEqual(diagnostics.length, testCase.expectedWarnings, `Failed: ${testCase.name} - Expected ${testCase.expectedWarnings} but got ${diagnostics.length}`);
                if (testCase.expectedWarnings > 0) {
                    assert(diagnostics.some(d => d.message.includes(testCase.errorMessage)), `Failed: ${testCase.name} - Warning message should include '${testCase.errorMessage} - instead, is this: ${diagnostics[0].message}'`);
                }
            } else {
                assert.strictEqual(diagnostics.length, testCase.expectedErrors, `Failed: ${testCase.name} - Expected ${testCase.expectedErrors} but got ${diagnostics.length}`);
                if (testCase.expectedErrors > 0) {
                    assert(diagnostics.some(d => d.message.includes(testCase.errorMessage)), `Failed: ${testCase.name} - Error message should include '${testCase.errorMessage} - instead, is this: ${diagnostics[0].message}'`);
                }
            }
            passed++;
        } catch (e) {
            console.error(e.message, diagnostics);
        }
    }

    console.log(`${passed}/${testCases.length} tests passed`);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
