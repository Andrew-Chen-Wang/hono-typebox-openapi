import { describe, expect, it } from "vitest"
import convert from "./toOpenAPISchema"

// These tests drive `convert` with raw JSON-Schema inputs that mirror the exact shapes a
// backend emits (and that a hand-written normalizer would otherwise fix), rather than
// TypeBox builders — the shapes (nested unions, 248-member const unions) are awkward to
// express through TypeBox and the point is to lock the wire-level transform.
// `swiftGenerator` selects the `target: "swift-openapi-generator"` normalization.
type SchemaRecord = Record<string, unknown>
const run = async (schema: any, swiftGenerator: boolean): Promise<SchemaRecord> =>
  (await convert(
    structuredClone(schema),
    swiftGenerator ? { target: "swift-openapi-generator" } : undefined,
  )) as unknown as SchemaRecord

// A nullable field wrapping a nested union, e.g. profile.transgender:
//   anyOf[ anyOf[ enum, {type:string,maxLength:0} ], null ]
const demographic = {
  anyOf: [{ anyOf: [{ enum: ["Yes", "No"] }, { type: "string", maxLength: 0 }] }, { type: "null" }],
}
// A nullable union with several non-null members.
const multiMemberNullable = {
  anyOf: [
    { type: "array", items: { type: "string" } },
    { type: "string" },
    { type: "number" },
    { type: "null" },
  ],
}
// A nullable union whose only non-null member is an empty schema.
const emptyMemberNullable = { anyOf: [{}, { type: "null" }] }
// A large all-`const`-string union (country/timezone), no null member.
const largeConstUnion = {
  anyOf: Array.from({ length: 248 }, (_, i) => ({ type: "string", const: `C${i}` })),
}
// A small const-string union that must be preserved.
const smallConstUnion = {
  anyOf: [
    { type: "string", const: "a" },
    { type: "string", const: "b" },
  ],
}

describe('target: "swift-openapi-generator" normalization (real-world spec shapes)', () => {
  it("strips null and inlines the sole member of a nested-union nullable", async () => {
    const out = await run(demographic, true)
    expect(JSON.stringify(out)).not.toContain('"null"')
    expect(out.anyOf).toEqual([{ enum: ["Yes", "No"] }, { type: "string", maxLength: 0 }])
  })

  it("drops only the null member from a multi-member nullable union", async () => {
    const out = await run(multiMemberNullable, true)
    expect(JSON.stringify(out)).not.toContain('{"type":"null"}')
    expect(out.anyOf).toEqual([
      { type: "array", items: { type: "string" } },
      { type: "string" },
      { type: "number" },
    ])
  })

  it("inlines an empty member, dropping the null", async () => {
    const out = await run(emptyMemberNullable, true)
    expect(out).toEqual({})
  })

  it("collapses a large const-string union to a plain string", async () => {
    const out = await run(largeConstUnion, true)
    expect(out).toEqual({ type: "string" })
  })

  it("preserves a small const-string union", async () => {
    const out = await run(smallConstUnion, true)
    expect(out.anyOf).toEqual([
      { type: "string", const: "a" },
      { type: "string", const: "b" },
    ])
  })

  // The empty schema still accepts `null`, so the property keeps its `required` entry — the
  // server requires the field to be present, and the document must say the same.
  it("opens a standalone {type:null} to {} and keeps it required", async () => {
    const out = await run(
      {
        type: "object",
        required: ["approved", "id"],
        properties: { approved: { type: "null" }, id: { type: "string" } },
      },
      true,
    )
    expect(out.required).toEqual(["approved", "id"])
    expect((out.properties as Record<string, unknown>).approved).toEqual({})
  })

  it("drops a nested-union nullable property from the parent required array", async () => {
    const out = await run(
      {
        type: "object",
        required: ["x", "y"],
        properties: { x: demographic, y: { type: "string" } },
      },
      true,
    )
    expect(out.required).toEqual(["y"])
  })

  describe('default "anyOf" mode leaves all of these untouched', () => {
    it("keeps nested-union nullable as-is", async () => {
      expect(await run(demographic, false)).toEqual(demographic)
    })
    it("keeps multi-member nullable as-is", async () => {
      expect(await run(multiMemberNullable, false)).toEqual(multiMemberNullable)
    })
    it("keeps the large const union as-is", async () => {
      const out = await run(largeConstUnion, false)
      expect((out.anyOf as unknown[]).length).toBe(248)
      expect(out.type).toBeUndefined()
    })
  })
})
