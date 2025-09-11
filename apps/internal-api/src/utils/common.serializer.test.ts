import { Type } from "@sinclair/typebox"
import { Value } from "@sinclair/typebox/value"
import { describe, expect, it } from "vitest"
import { Refine } from "./common.serializer"

describe("validate Refine", () => {
  it("should throw an error if the value is not a valid positive integer", () => {
    const T = Refine(Type.String(), (value) => value.length <= 255, {
      message: "String can't be more than 255 characters",
    })
    expect(Value.Parse(T, "".padEnd(255))).toBe("".padEnd(255))
    expect(() => Value.Parse(T, "a".repeat(256))).toThrow(
      "String can't be more than 255 characters",
    )
  })
})
