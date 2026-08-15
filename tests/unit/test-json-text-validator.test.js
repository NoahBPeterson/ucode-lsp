// Direct unit tests for src/analysis/jsonTextValidator.ts.
//
// json() parses with json-c (`json_tokener_parse_ex`), which is markedly more
// lenient than JavaScript's JSON.parse — using the latter as the oracle would
// FALSE-POSITIVE on working input. Every expectation below was differential-
// tested against the real interpreter (owrt-main) before being written here:
// 42 cases, 42 agreements, 0 mismatches.
//
// Re-run the differential after touching the validator:
//   docker run --rm -v <cases>.uc:/t.uc owrt-main-img ucode /t.uc
import { test, expect, describe } from 'bun:test';
import { validateJsonText } from '../../src/analysis/jsonTextValidator.ts';

describe('accepts what json-c accepts', () => {
  for (const s of [
    '{"a":1}', '[1,2]', '"str"', '42', 'true', 'null', '2.5',
    '{"a":{"b":[1,{"c":null}]}}', '[[[]]]', '{"a":-1.5e-3}', '{}', '[]',
    '  {"a":1}  ', '{"a":"\\u00e9"}', '{"dup":1,"dup":2}', '1e5',
  ]) {
    test(`valid: ${s}`, () => { expect(validateJsonText(s)).toBe('valid'); });
  }
});

describe("accepts json-c's leniencies — JSON.parse would reject all of these", () => {
  for (const [s, why] of [
    ["{'a':1}", 'single-quoted key and value'],
    ['{"a":1,}', 'trailing comma in an object'],
    ['[1,2,]', 'trailing comma in an array'],
    ['NaN', 'NaN literal'],
    ['Infinity', 'Infinity literal'],
    ['-Infinity', 'negative Infinity'],
    ['nan', 'lowercase nan'],
    ['01', 'leading zero'],
    ['{"a":1 /* c */}', 'block comment between tokens'],
    ["'single'", 'single-quoted string'],
  ]) {
    test(`valid (${why}): ${s}`, () => { expect(validateJsonText(s)).toBe('valid'); });
  }
});

describe('rejects what json-c rejects', () => {
  for (const [s, why] of [
    ['{1:2}', 'object key must be a QUOTED string'],
    ['{a:1}', 'bare identifier key'],
    ['.5', 'leading-dot number'],
    ['+1', 'unary plus'],
    ['0x10', 'hex literal'],
    ['{"a":1} trailing', 'content after the value'],
    ['', 'empty input'],
    ['   ', 'whitespace only'],
    ['// c', 'line comment with no value'],
    ['[1,2', 'unterminated array'],
    ['{"a":1', 'unterminated object'],
    ['"unterminated', 'unterminated string'],
    ['[1 2]', 'missing comma'],
    ['{"a"1}', 'missing colon'],
    ['{"a":}', 'missing value'],
    ['[,]', 'bare comma'],
  ]) {
    test(`invalid (${why}): ${JSON.stringify(s)}`, () => {
      expect(validateJsonText(s)).toBe('invalid');
    });
  }
});

describe('never claims more than it can prove', () => {
  test('an unterminated block comment is unsure, not invalid', () => {
    expect(validateJsonText('{"a":1 /* never closed')).toBe('unsure');
  });
  test('pathological nesting bails to unsure rather than mis-reporting', () => {
    expect(validateJsonText('['.repeat(200) + ']'.repeat(200))).toBe('unsure');
  });
});
