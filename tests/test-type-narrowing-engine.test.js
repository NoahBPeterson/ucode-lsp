// Unit tests for TypeNarrowingEngine (src/analysis/typeNarrowing.ts).
//
// This engine had ZERO direct unit tests — all its coverage was incidental via
// e2e flows. These tests exercise every public method directly and exhaustively
// over UcodeType (per the project's exhaustive-Match convention), so adding a new
// UcodeType breaks the suite until it's covered.
//
// They also pin the array!=object semantics: isTypeCompatible no longer treats
// array and object as interchangeable (the `in` operator checks both explicitly
// via `isSubtype(x, OBJECT) || isSubtype(x, ARRAY)`, so it never needed that).

import { test, expect, describe } from 'bun:test';
import { Match } from 'effect';
import { TypeNarrowingEngine } from '../src/analysis/typeNarrowing';
import {
  UcodeType,
  createUnionType,
  createArrayType,
  getUnionTypes,
} from '../src/analysis/symbolTable';

const eng = new TypeNarrowingEngine();

const ALL_TYPES = Object.values(UcodeType);
const CONCRETE = ALL_TYPES.filter((t) => t !== UcodeType.UNION);

// Exhaustive representative value for every UcodeType. Match.exhaustive means a
// newly-added enum member fails until a case is added here.
const reprForType = (t) =>
  Match.value(t).pipe(
    Match.when(UcodeType.INTEGER, () => UcodeType.INTEGER),
    Match.when(UcodeType.DOUBLE, () => UcodeType.DOUBLE),
    Match.when(UcodeType.STRING, () => UcodeType.STRING),
    Match.when(UcodeType.BOOLEAN, () => UcodeType.BOOLEAN),
    Match.when(UcodeType.ARRAY, () => UcodeType.ARRAY),
    Match.when(UcodeType.OBJECT, () => UcodeType.OBJECT),
    Match.when(UcodeType.FUNCTION, () => UcodeType.FUNCTION),
    Match.when(UcodeType.REGEX, () => UcodeType.REGEX),
    Match.when(UcodeType.NULL, () => UcodeType.NULL),
    Match.when(UcodeType.UNKNOWN, () => UcodeType.UNKNOWN),
    Match.when(UcodeType.UNION, () => createUnionType([UcodeType.STRING, UcodeType.NULL])),
    Match.exhaustive
  );

// Reference for isSubtype on single concrete types — the rules in isTypeCompatible:
// reflexive, UNKNOWN absorbs both directions, integer widens to double.
// array and object are NOT mutually compatible (the leniency we removed).
const refSubtype = (a, e) =>
  a === e ||
  e === UcodeType.UNKNOWN ||
  a === UcodeType.UNKNOWN ||
  (a === UcodeType.INTEGER && e === UcodeType.DOUBLE);

const asSet = (t) => new Set(getUnionTypes(t));

describe('isSubtype — exhaustive single-type matrix', () => {
  test('reprForType handles every UcodeType (exhaustiveness guard)', () => {
    for (const t of ALL_TYPES) expect(reprForType(t)).toBeDefined();
  });

  for (const a of CONCRETE) {
    test(`isSubtype(${a}, *) matches the rules`, () => {
      for (const e of CONCRETE) {
        expect(eng.isSubtype(a, e)).toBe(refSubtype(a, e));
      }
    });
  }

  test('array and object are NOT interchangeable (regression for removed leniency)', () => {
    expect(eng.isSubtype(UcodeType.ARRAY, UcodeType.OBJECT)).toBe(false);
    expect(eng.isSubtype(UcodeType.OBJECT, UcodeType.ARRAY)).toBe(false);
    // refined array<int> resolves to base array — still not an object
    expect(eng.isSubtype(createArrayType(UcodeType.INTEGER), UcodeType.OBJECT)).toBe(false);
    expect(eng.isSubtype(createArrayType(UcodeType.INTEGER), UcodeType.ARRAY)).toBe(true);
  });

  test('integer widens to double but not vice versa', () => {
    expect(eng.isSubtype(UcodeType.INTEGER, UcodeType.DOUBLE)).toBe(true);
    expect(eng.isSubtype(UcodeType.DOUBLE, UcodeType.INTEGER)).toBe(false);
  });

  test('a union is a subtype only if EVERY member is', () => {
    expect(eng.isSubtype(createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]), UcodeType.DOUBLE)).toBe(true);
    expect(eng.isSubtype(createUnionType([UcodeType.STRING, UcodeType.NULL]), UcodeType.STRING)).toBe(false);
  });
});

describe('isSubtypeOfUnion — pure base-set membership (no widening)', () => {
  test('empty expected set is never a subtype', () => {
    expect(eng.isSubtypeOfUnion(UcodeType.STRING, [])).toBe(false);
  });

  for (const a of CONCRETE) {
    test(`isSubtypeOfUnion(${a}, ...) by base membership`, () => {
      expect(eng.isSubtypeOfUnion(a, [a])).toBe(true);
      // Unlike isSubtype: no int->double widening, no UNKNOWN absorption.
      const others = CONCRETE.filter((t) => t !== a);
      expect(eng.isSubtypeOfUnion(a, others)).toBe(false);
    });
  }

  test('refined array member counts as base array', () => {
    expect(eng.isSubtypeOfUnion(createArrayType(UcodeType.STRING), [UcodeType.ARRAY])).toBe(true);
  });

  test('all union members must be in the allowed set', () => {
    const sn = createUnionType([UcodeType.STRING, UcodeType.NULL]);
    expect(eng.isSubtypeOfUnion(sn, [UcodeType.STRING, UcodeType.NULL])).toBe(true);
    expect(eng.isSubtypeOfUnion(sn, [UcodeType.STRING])).toBe(false);
  });
});

describe('removeNullFromType — exhaustive', () => {
  for (const t of CONCRETE) {
    test(`single ${t}`, () => {
      const r = eng.removeNullFromType(t);
      if (t === UcodeType.NULL) {
        expect(r.narrowedType).toBe(UcodeType.UNKNOWN);
        expect(r.excludedTypes).toEqual([UcodeType.NULL]);
      } else {
        expect(r.narrowedType).toBe(t);
        expect(r.excludedTypes).toEqual([]);
      }
    });

    test(`union ${t} | null drops null`, () => {
      if (t === UcodeType.NULL) return; // null|null collapses to null
      const r = eng.removeNullFromType(createUnionType([t, UcodeType.NULL]));
      expect(asSet(r.narrowedType).has(UcodeType.NULL)).toBe(false);
      expect(asSet(r.narrowedType).has(t)).toBe(true);
      expect(r.excludedTypes).toEqual([UcodeType.NULL]);
    });
  }

  test('union without null is unchanged', () => {
    const u = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    const r = eng.removeNullFromType(u);
    expect(r.excludedTypes).toEqual([]);
    expect(asSet(r.narrowedType)).toEqual(asSet(u));
  });
});

describe('removeTypesFromUnion / keepOnlyTypes', () => {
  test('removeTypesFromUnion drops listed types from a union', () => {
    const u = createUnionType([UcodeType.STRING, UcodeType.INTEGER, UcodeType.NULL]);
    const r = eng.removeTypesFromUnion(u, [UcodeType.NULL]);
    expect(asSet(r.narrowedType).has(UcodeType.NULL)).toBe(false);
    expect(asSet(r.narrowedType).has(UcodeType.STRING)).toBe(true);
    expect(r.excludedTypes).toEqual([UcodeType.NULL]);
  });

  test('removeTypesFromUnion on a matching single type narrows to unknown', () => {
    const r = eng.removeTypesFromUnion(UcodeType.NULL, [UcodeType.NULL]);
    expect(r.narrowedType).toBe(UcodeType.UNKNOWN);
    expect(r.excludedTypes).toEqual([UcodeType.NULL]);
  });

  test('removeTypesFromUnion on a non-matching single type is unchanged', () => {
    const r = eng.removeTypesFromUnion(UcodeType.STRING, [UcodeType.NULL]);
    expect(r.narrowedType).toBe(UcodeType.STRING);
    expect(r.excludedTypes).toEqual([]);
  });

  test('keepOnlyTypes keeps the listed members of a union', () => {
    const u = createUnionType([UcodeType.STRING, UcodeType.INTEGER, UcodeType.NULL]);
    const r = eng.keepOnlyTypes(u, [UcodeType.STRING]);
    expect(asSet(r.narrowedType)).toEqual(new Set([UcodeType.STRING]));
  });

  test('keepOnlyTypes narrows UNKNOWN to the guarded type', () => {
    const r = eng.keepOnlyTypes(UcodeType.UNKNOWN, [UcodeType.ARRAY]);
    expect(r.narrowedType).toBe(UcodeType.ARRAY);
  });

  test('keepOnlyTypes on a non-matching single type narrows away to unknown', () => {
    const r = eng.keepOnlyTypes(UcodeType.STRING, [UcodeType.ARRAY]);
    expect(r.narrowedType).toBe(UcodeType.UNKNOWN);
    expect(r.excludedTypes).toEqual([UcodeType.STRING]);
  });
});

describe('containsNull / containsType — exhaustive', () => {
  for (const t of CONCRETE) {
    test(`containsNull(${t}) / containsType(${t}, ${t})`, () => {
      expect(eng.containsNull(t)).toBe(t === UcodeType.NULL);
      expect(eng.containsType(t, t)).toBe(true);
    });
  }

  test('containsNull/containsType see members of a union', () => {
    const u = createUnionType([UcodeType.STRING, UcodeType.NULL]);
    expect(eng.containsNull(u)).toBe(true);
    expect(eng.containsType(u, UcodeType.STRING)).toBe(true);
    expect(eng.containsType(u, UcodeType.INTEGER)).toBe(false);
  });
});

describe('getIncompatibleTypes / getIncompatibilityDescription / requiresNullCheck', () => {
  test('getIncompatibleTypes returns members not assignable to expected', () => {
    const u = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    expect(new Set(eng.getIncompatibleTypes(u, UcodeType.STRING))).toEqual(new Set([UcodeType.INTEGER]));
    // integer widens to double, so neither member is incompatible with double
    const u2 = createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]);
    expect(eng.getIncompatibleTypes(u2, UcodeType.DOUBLE)).toEqual([]);
  });

  test('getIncompatibilityDescription is empty when fully compatible', () => {
    expect(eng.getIncompatibilityDescription(UcodeType.STRING, UcodeType.STRING)).toBe('');
  });

  test('getIncompatibilityDescription names the offending types', () => {
    const u = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    const desc = eng.getIncompatibilityDescription(u, UcodeType.STRING);
    expect(desc).toContain('integer');
    expect(desc).toContain('string');
  });

  test('requiresNullCheck only when null is mixed with other types', () => {
    expect(eng.requiresNullCheck(createUnionType([UcodeType.STRING, UcodeType.NULL]), 'dot')).toBe(true);
    expect(eng.requiresNullCheck(UcodeType.NULL, 'dot')).toBe(false); // always null → no guard suggested
    expect(eng.requiresNullCheck(UcodeType.STRING, 'dot')).toBe(false); // no null at all
  });
});
