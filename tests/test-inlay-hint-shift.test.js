// Unit tests for shiftRawHints — the optimistic position-shift that keeps inlay
// hints glued to the code while analysis is debounced behind edits.
const { test, expect } = require('bun:test');
const { shiftRawHints } = require('../src/inlayHints');

// Helper: a raw hint is just an offset + payload; only `offset` matters here.
const h = (offset) => ({ offset, label: `:${offset}`, kind: 1, paddingLeft: false, paddingRight: true });
const offsets = (arr) => arr.map((x) => x.offset);

test('no-op when text is unchanged', () => {
  const raw = [h(0), h(5), h(10)];
  expect(offsets(shiftRawHints(raw, 'abcdefghij', 'abcdefghij'))).toEqual([0, 5, 10]);
});

test('insertion shifts only anchors at/after the edit point', () => {
  // Insert "XX" at offset 4: "abcd|efgh" -> "abcdXXefgh"
  const oldText = 'abcdefgh';
  const newText = 'abcdXXefgh';
  const raw = [h(2), h(4), h(6)];
  // h(2) is before the edit (kept); h(4) and h(6) are at/after (shift by +2).
  expect(offsets(shiftRawHints(raw, oldText, newText))).toEqual([2, 6, 8]);
});

test('deletion shifts trailing anchors back and drops one inside the removed span', () => {
  // Delete "cd" (offsets 2..4): "ab[cd]efgh" -> "abefgh"
  const oldText = 'abcdefgh';
  const newText = 'abefgh';
  const raw = [h(1), h(3), h(6)];
  // h(1) before (kept); h(3) is inside the removed span (dropped); h(6) after (-2).
  expect(offsets(shiftRawHints(raw, oldText, newText))).toEqual([1, 4]);
});

test('replacement drops anchors inside the changed region, shifts the tail', () => {
  // Replace "cde" with "Z": "ab[cde]fg" -> "abZfg" (delta -2)
  const oldText = 'abcdefg';
  const newText = 'abZfg';
  const raw = [h(1), h(3), h(5)];
  // h(1) before (kept); h(3) inside (dropped); h(5) after (-2 -> 3).
  expect(offsets(shiftRawHints(raw, oldText, newText))).toEqual([1, 3]);
});

test('single-char append shifts nothing before it', () => {
  const oldText = 'let x = f()';
  const newText = 'let x = f();'; // typed ';' at the end
  const raw = [h(5)]; // a hint after `x`
  expect(offsets(shiftRawHints(raw, oldText, newText))).toEqual([5]);
});

test('typing at the start shifts every anchor forward', () => {
  const oldText = 'foo';
  const newText = ' foo'; // leading space
  const raw = [h(0), h(1), h(3)];
  expect(offsets(shiftRawHints(raw, oldText, newText))).toEqual([1, 2, 4]);
});
