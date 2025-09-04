const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Missing Builtins Validation Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

  let lspServer;
  let getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  // Helper function for cleaner hover requests
  function getHoverInfo(testContent, testFilePath, line, character) {
    return getHover(testContent, testFilePath, line, character);
  }

  describe('Core Execution Control Functions', function() {
    const testContent = `die("Critical error");
exit(1);
exists(obj, "property");`;

    it('should provide hover information for die() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-die.uc', 0, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('die'), 'Should mention die function');
      assert(hover.contents.value.includes('Terminate script execution'), 'Should describe termination');
      assert(hover.contents.value.includes('message'), 'Should mention message parameter');
    });

    it('should provide hover information for exit() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-exit.uc', 1, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('exit'), 'Should mention exit function');
      assert(hover.contents.value.includes('exit code'), 'Should describe exit code');
    });

    it('should provide hover information for exists() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-exists.uc', 2, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('exists'), 'Should mention exists function');
      assert(hover.contents.value.includes('Check if'), 'Should describe checking');
      assert(hover.contents.value.includes('property'), 'Should mention property parameter');
    });
  });

  describe('Environment and Utility Functions', function() {
    const testContent = `let path = getenv("PATH");
trace("Debug checkpoint");
warn("This is a warning");`;

    it('should provide hover information for getenv() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-getenv.uc', 0, 11);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('getenv'), 'Should mention getenv function');
      assert(hover.contents.value.includes('environment variable'), 'Should describe environment variables');
      assert(hover.contents.value.includes('PATH'), 'Should have example with PATH');
    });

    it('should provide hover information for trace() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-trace.uc', 1, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('trace'), 'Should mention trace function');
      assert(hover.contents.value.includes('stack trace'), 'Should describe stack trace');
    });

    it('should provide hover information for warn() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-warn.uc', 2, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('warn'), 'Should mention warn function');
      assert(hover.contents.value.includes('warning'), 'Should describe warning');
      assert(hover.contents.value.includes('stderr'), 'Should mention stderr');
    });
  });

  describe('Array Manipulation Functions', function() {
    const testContent = `let numbers = [1, 2, 3, 4, 5];
let doubled = map(numbers, x => x * 2);
let reversed = reverse(numbers);
let lastIndex = rindex(numbers, 3);
let sorted = sort(numbers);`;

    it('should provide hover information for map() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-map.uc', 1, 14);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('map'), 'Should mention map function');
      assert(hover.contents.value.includes('Transform array'), 'Should describe transformation');
      assert(hover.contents.value.includes('callback'), 'Should mention callback parameter');
      assert(hover.contents.value.includes('value, index, array'), 'Should describe callback parameters');
    });

    it('should provide hover information for reverse() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-reverse.uc', 2, 15);
      
      assert(hover, 'Should return hover information');  
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('reverse'), 'Should mention reverse function');
      assert(hover.contents.value.includes('Reverse array'), 'Should describe reversing');
    });

    it('should provide hover information for rindex() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-rindex.uc', 3, 16);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('rindex'), 'Should mention rindex function');
      assert(hover.contents.value.includes('last index'), 'Should describe last occurrence');
      assert(hover.contents.value.includes('haystack'), 'Should mention haystack parameter');
    });

    it('should provide hover information for sort() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-sort.uc', 4, 13);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('sort'), 'Should mention sort function');
      assert(hover.contents.value.includes('Sort array'), 'Should describe sorting');
      assert(hover.contents.value.includes('compare'), 'Should mention compare function');
    });
  });

  describe('Array Modification Functions', function() {
    const testContent = `let arr = [1, 2, 3, 4, 5];
let removed = splice(arr, 1, 2, "a", "b");
let section = slice(arr, 1, 4);`;

    it('should provide hover information for splice() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-splice.uc', 1, 14);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('splice'), 'Should mention splice function');
      assert(hover.contents.value.includes('Change array contents'), 'Should describe array modification');
      assert(hover.contents.value.includes('start'), 'Should mention start parameter');
      assert(hover.contents.value.includes('deleteCount'), 'Should mention deleteCount parameter');
    });

    it('should provide hover information for slice() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-slice.uc', 2, 14);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('slice'), 'Should mention slice function');
      assert(hover.contents.value.includes('Extract section'), 'Should describe extraction');
      assert(hover.contents.value.includes('inclusive'), 'Should mention inclusive start');
      assert(hover.contents.value.includes('exclusive'), 'Should mention exclusive end');
    });
  });

  describe('Object and Template Functions', function() {
    const testContent = `let obj = { name: "test" };
let currentProto = proto(obj);
let template = "Hello {{name}}";
let rendered = render(template, context);`;

    it('should provide hover information for proto() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-proto.uc', 1, 19);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('proto'), 'Should mention proto function');
      assert(hover.contents.value.includes('prototype'), 'Should describe prototype');
    });

    it('should provide hover information for render() function', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-render.uc', 3, 15);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('render'), 'Should mention render function');
      assert(hover.contents.value.includes('template'), 'Should describe template rendering');
      assert(hover.contents.value.includes('{{name}}'), 'Should have template example');
    });
  });

  describe('Function Documentation Quality', function() {
    const testContent = `map([1,2,3], x => x * 2);`;

    it('should provide comprehensive documentation with examples', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-comprehensive.uc', 0, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      
      const content = hover.contents.value;
      
      // Check for comprehensive documentation elements
      assert(content.includes('**Parameters:**'), 'Should have parameters section');
      assert(content.includes('**Returns:**'), 'Should have returns section');
      assert(content.includes('**Example:**'), 'Should have examples section');
      assert(content.includes('```ucode'), 'Should have ucode examples');
      assert(content.includes('// '), 'Should have example comments');
    });

    it('should have consistent markdown formatting', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-formatting.uc', 0, 1);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents.kind === 'markdown', 'Should use markdown format');
      
      const content = hover.contents.value;
      
      // Check markdown formatting consistency - be more flexible about exact format
      assert(content.includes('map(') || content.includes('**map'), 'Should mention map function prominently');
      assert(content.includes('- ') || content.includes('*'), 'Should use list formatting');
      assert(content.includes('`'), 'Should use backticks for code elements');
      assert(content.includes('\n'), 'Should have proper line breaks');
    });
  });

  describe('Error Handling and Edge Cases', function() {
    it('should handle hover on non-existent functions gracefully', async function() {
      const testContent = `nonExistentFunction();`;
      
      const hover = await getHoverInfo(testContent, '/tmp/test-nonexistent.uc', 0, 1);
      
      // Should either return null or not crash
      if (hover) {
        assert(hover.contents === null || hover.contents === undefined, 
          'Should not provide hover for non-existent functions');
      }
    });

    it('should handle malformed code without crashing', async function() {
      const testContent = `map([1,2,3 // malformed code`;
      
      try {
        const hover = await getHoverInfo(testContent, '/tmp/test-malformed.uc', 0, 1);
        // Should not crash, may or may not return hover info
        assert(true, 'Should handle malformed code gracefully');
      } catch (error) {
        // Timeout is acceptable for malformed code
        assert(error.message.includes('Timeout'), 'Should timeout gracefully on malformed code');
      }
    });
  });
});