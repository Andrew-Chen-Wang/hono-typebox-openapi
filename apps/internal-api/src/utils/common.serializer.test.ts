import { Refine, Type } from "typebox"
import { ParseError, Value } from "typebox/value"
import { describe, expect, it } from "vitest"

describe("validate Refine", () => {
  it("should throw an error", () => {
    const T = Refine(
      Type.String(),
      (value) => value.length <= 255,
      "String can't be more than 255 characters",
    )
    expect(Value.Parse(T, "".padEnd(255))).toBe("".padEnd(255))
    expect(() => Value.Parse(T, "a".repeat(256))).toThrow(ParseError)
  })
})
