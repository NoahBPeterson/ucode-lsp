// UC6020 — a `{# … #}` template comment ends at its FIRST '#}' (ucode lexer.c scans to
// the first `#}`/`-#}`), so a terminator inside the intended body cuts the comment short
// and the tail — including the author's real terminator — is rendered as page output.
// Oracle-verified: `{#\n intended comment #} leaked text -#}\n` prints " leaked text -#}".
//
// The warning fires ONLY on the near-certain signature: another '#}' in the literal text
// between the comment's close and the next tag open. Plain text containing '#}' with no
// preceding comment, or separated from it by a tag, is never flagged.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';

function lexTemplate(src) {
  const lx = new UcodeLexer(src, { rawMode: false });
  lx.tokenize();
  return lx.errors.filter((e) => e.code === 'UC6020');
}

describe('UC6020 template comment ended early', () => {
  test('the demo shape: a #} inside the body flags the stray trailing terminator', () => {
    const src = '{#\n intended comment #} leaked text -#}\n<p>real</p>\n';
    const errs = lexTemplate(src);
    expect(errs.length).toBe(1);
    expect(errs[0].severity).toBe('warning');
    expect(src.slice(errs[0].start, errs[0].end)).toBe('-#}');
    expect(errs[0].message).toContain('page output');
  });

  test('a stray plain #} (no minus) is flagged too', () => {
    const src = '{# a #} tail #} more\n';
    const errs = lexTemplate(src);
    expect(errs.length).toBe(1);
    expect(src.slice(errs[0].start, errs[0].end)).toBe('#}');
  });

  test('a clean multi-line {# … -#} comment does not flag', () => {
    expect(lexTemplate('{#\n multi\n line\n-#}\n<p>x</p>\n{% let a = 1; %}')).toEqual([]);
  });

  test('plain text containing #} with NO preceding comment does not flag', () => {
    expect(lexTemplate('<p>#} just text</p>\n{% let a = 1; %}')).toEqual([]);
  });

  test('a tag between the comment and the later #} suppresses the claim', () => {
    // After `{% … %}` we can no longer attribute the '#}' to the earlier comment.
    expect(lexTemplate('{# a #}{% let a = 1; %} text #} more\n')).toEqual([]);
  });

  test('back-to-back comments do not flag each other', () => {
    expect(lexTemplate('{# one #} {# two #}\n{% let a = 1; %}')).toEqual([]);
  });

  test('a {% inside the comment body still belongs to the comment (no flag)', () => {
    expect(lexTemplate('{# has {% and {{ inside #}\n{% let a = 1; %}')).toEqual([]);
  });

  // ── the quick-fix payload: split every inner '#}' so the comment reaches the
  //    author's intended (LAST) terminator ─────────────────────────────────────
  const applyFix = (src, err) => {
    const offsets = [...err.data.commentEndedEarly.insertSpaceBefore].sort((a, b) => b - a);
    let out = src;
    for (const o of offsets) out = out.slice(0, o) + ' ' + out.slice(o);
    return out;
  };

  test('fix payload: applying the inserts extends the comment to the intended -#}', () => {
    const src = '{#\n comment mentions #} and keeps going\n-#}\n<p>x</p>\n';
    const [err] = lexTemplate(src);
    expect(err.data.commentEndedEarly.insertSpaceBefore.length).toBe(1);
    const fixed = applyFix(src, err);
    expect(fixed).toContain('mentions # } and');
    expect(lexTemplate(fixed)).toEqual([]); // clean after the fix
  });

  test('fix payload: MULTIPLE inner terminators are all split in one application', () => {
    const src = '{# a #} b #} c -#}\n<p>x</p>\n';
    const [err] = lexTemplate(src);
    // Two inner '#}' pairs (the early close and the mid stray); the final '-#}' is kept.
    expect(err.data.commentEndedEarly.insertSpaceBefore.length).toBe(2);
    const fixed = applyFix(src, err);
    expect(fixed).toBe('{# a # } b # } c -#}\n<p>x</p>\n');
    expect(lexTemplate(fixed)).toEqual([]);
  });
});
