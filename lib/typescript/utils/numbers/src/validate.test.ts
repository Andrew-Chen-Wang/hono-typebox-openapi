import { describe, expect, it } from "vitest"
import { isValidPositiveInteger } from "./validate.ts"

describe("isValidPositiveInteger", () => {
  it("should return false for null or undefined", () => {
    expect(isValidPositiveInteger(null)).toBe(false)
    expect(isValidPositiveInteger(undefined)).toBe(false)
  })

  it("should return false for non-integer numbers", () => {
    expect(isValidPositiveInteger(1.5)).toBe(false)
    expect(isValidPositiveInteger("1.5")).toBe(false)
  })

  it("should return false for non-numeric strings", () => {
    expect(isValidPositiveInteger("abc")).toBe(false)
  })

  it("should return false for negative numbers", () => {
    expect(isValidPositiveInteger(-1)).toBe(false)
  })

  it("should return false for zero when allowZero is false", () => {
    expect(isValidPositiveInteger(0)).toBe(false)
  })

  it("should return true for positive integers", () => {
    expect(isValidPositiveInteger(1)).toBe(true)
    expect(isValidPositiveInteger("1")).toBe(true)
  })

  it("should return true for zero when allowZero is true", () => {
    expect(isValidPositiveInteger(0, true)).toBe(true)
  })
})
