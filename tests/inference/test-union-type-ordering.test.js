// typeToString display order for union types: concrete types first (in their existing order),
// then `unknown`, then `null` last — so hovers read `integer | null`, not `null | integer`.
import { test, expect } from "bun:test";
import { typeToString, createUnionType, UcodeType } from "../../src/analysis/symbolTable";

const T = (...members) => typeToString(createUnionType(members));

test("null is always last", () => {
  expect(T(UcodeType.NULL, UcodeType.INTEGER)).toBe("integer | null");
  expect(T(UcodeType.STRING, UcodeType.NULL, UcodeType.INTEGER)).toBe("string | integer | null");
});

test("unknown comes before null, after everything else", () => {
  expect(T(UcodeType.NULL, UcodeType.UNKNOWN)).toBe("unknown | null");
  expect(T(UcodeType.NULL, UcodeType.UNKNOWN, UcodeType.STRING)).toBe("string | unknown | null");
});

test("concrete members keep their relative order (stable)", () => {
  expect(T(UcodeType.STRING, UcodeType.INTEGER)).toBe("string | integer");
  expect(T(UcodeType.INTEGER, UcodeType.STRING, UcodeType.NULL)).toBe("integer | string | null");
});
