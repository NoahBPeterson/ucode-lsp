// Direct test of hover functionality without language server protocol
const fs = require('fs');
const path = require('path');

console.log('🔍 Direct testing of hover functionality...\n');

// First, let's just check that our changes are actually in the compiled code
console.log('📋 Step 1: Check compiled hover.js in dist/server.js...');

const serverJsPath = path.join(__dirname, '../dist/server.js');
if (!fs.existsSync(serverJsPath)) {
  console.log('❌ server.js not found at', serverJsPath);
  process.exit(1);
}

const serverJs = fs.readFileSync(serverJsPath, 'utf8');

// Check if our changes are in the compiled code
const hasUloopMethodHover = serverJs.includes('getUloopMethodHover');
const hasUloopObjectRegistry = serverJs.includes('uloopObjectRegistry');
const hasDeleteMethod = serverJs.includes('delete') && serverJs.includes('Unregisters');

console.log('✅ Compiled code analysis:');
console.log('  - getUloopMethodHover function:', hasUloopMethodHover ? '✅ Found' : '❌ Missing');
console.log('  - uloopObjectRegistry:', hasUloopObjectRegistry ? '✅ Found' : '❌ Missing');  
console.log('  - delete method definitions:', hasDeleteMethod ? '✅ Found' : '❌ Missing');

if (!hasUloopMethodHover || !hasUloopObjectRegistry) {
  console.log('\n❌ PROBLEM: The compiled code is missing our changes!');
  console.log('💡 You need to run "bun run compile" to rebuild with the latest changes.');
  process.exit(1);
}

console.log('\n📋 Step 2: Check if uloop delete methods are defined...');

// Check the source to verify delete methods are there
const uloopTypesPath = path.join(__dirname, '../src/analysis/uloopTypes.ts');
const uloopTypes = fs.readFileSync(uloopTypesPath, 'utf8');

const handleDeleteMatch = uloopTypes.match(/\['delete',\s*\{[^}]*name:\s*'delete'[^}]*description:\s*'([^']*handle[^']*)/);
const processDeleteMatch = uloopTypes.match(/\['delete',\s*\{[^}]*name:\s*'delete'[^}]*description:\s*'([^']*process[^']*)/);
const signalDeleteMatch = uloopTypes.match(/\['delete',\s*\{[^}]*name:\s*'delete'[^}]*description:\s*'([^']*signal[^']*)/);

console.log('✅ Delete method definitions in source:');
console.log('  - handle.delete():', handleDeleteMatch ? '✅ Found' : '❌ Missing');
if (handleDeleteMatch) console.log('    Description:', handleDeleteMatch[1]);

console.log('  - process.delete():', processDeleteMatch ? '✅ Found' : '❌ Missing'); 
if (processDeleteMatch) console.log('    Description:', processDeleteMatch[1]);

console.log('  - signal.delete():', signalDeleteMatch ? '✅ Found' : '❌ Missing');
if (signalDeleteMatch) console.log('    Description:', signalDeleteMatch[1]);

console.log('\n📋 Step 3: Check hover function implementation...');

const hoverPath = path.join(__dirname, '../src/hover.ts');  
const hoverSource = fs.readFileSync(hoverPath, 'utf8');

// Check the hover function logic
const hasGetUloopMethodHover = hoverSource.includes('function getUloopMethodHover');
const hasUloopTypeCheck = hoverSource.includes('uloopObjectRegistry.isVariableOfUloopType');
const hasGetUloopMethod = hoverSource.includes('uloopObjectRegistry.getUloopMethod');
const hasMethodSignature = hoverSource.includes('methodSignature');

console.log('✅ Hover function implementation:');
console.log('  - getUloopMethodHover function:', hasGetUloopMethodHover ? '✅ Found' : '❌ Missing');
console.log('  - uloop type checking:', hasUloopTypeCheck ? '✅ Found' : '❌ Missing');
console.log('  - method lookup:', hasGetUloopMethod ? '✅ Found' : '❌ Missing');
console.log('  - method signature handling:', hasMethodSignature ? '✅ Found' : '❌ Missing');

console.log('\n📋 Step 4: Check if hover is called for member expressions...');

const hasDetectMemberExpression = hoverSource.includes('detectMemberExpression');
const hasGetUloopMethodHoverCall = hoverSource.includes('getUloopMethodHover(memberExpressionInfo');

console.log('✅ Member expression handling:');
console.log('  - detectMemberExpression:', hasDetectMemberExpression ? '✅ Found' : '❌ Missing');
console.log('  - calls getUloopMethodHover:', hasGetUloopMethodHoverCall ? '✅ Found' : '❌ Missing');

// Check the main hover handler
const hasHandleHover = hoverSource.includes('export function handleHover');
const callsDetectMemberExpression = hoverSource.includes('detectMemberExpression(offset, tokens)');

console.log('  - main handleHover function:', hasHandleHover ? '✅ Found' : '❌ Missing');
console.log('  - calls detectMemberExpression:', callsDetectMemberExpression ? '✅ Found' : '❌ Missing');

console.log('\n💡 Analysis:');
if (hasUloopMethodHover && hasUloopObjectRegistry && hasDeleteMethod && 
    hasGetUloopMethodHover && hasUloopTypeCheck && hasGetUloopMethod && 
    hasDetectMemberExpression && hasGetUloopMethodHoverCall) {
  console.log('✅ All implementation pieces are present in the code');
  console.log('🤔 The issue might be:');
  console.log('   1. The compiled code needs to be rebuilt');
  console.log('   2. VS Code extension needs to be restarted');
  console.log('   3. There is a runtime issue with symbol table or parsing');
  console.log('   4. The member expression detection is not working correctly');
} else {
  console.log('❌ Some implementation pieces are missing');
  console.log('🔧 Need to fix the missing parts');
}

console.log('\n🚀 Next steps:');
console.log('1. Make sure to run "bun run compile" to rebuild');
console.log('2. Restart VS Code or reload the language server');
console.log('3. Test with the test-actual-hover.uc file');
console.log('4. If still not working, there may be a runtime logic issue');