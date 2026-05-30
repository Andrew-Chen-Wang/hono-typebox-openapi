import { type TSchema, Type } from "typebox"
import { describe, expect, it } from "vitest"
import convert, { type NullableMode } from "./toOpenAPISchema"

// Mirrors the `Nullable` helper used by consumers: `Type.Union([T, Type.Null()])`,
// which TypeBox emits as `anyOf: [<schema>, { type: "null" }]`.
const Nullable = <T extends TSchema>(T: T) => Type.Union([T, Type.Null()])

// `convert` is typed to return an OpenAPI Document; for these schema-level assertions we
// view the result as a plain JSON Schema record.
type SchemaRecord = Record<string, unknown>
const toSchema = async (schema: TSchema, mode?: NullableMode): Promise<SchemaRecord> =>
  (await convert(schema, mode ? { nullableMode: mode } : undefined)) as unknown as SchemaRecord

describe("collapseNullable", () => {
  describe('default "anyOf" mode (web-client compatible — must not change)', () => {
    it("leaves a nullable object as anyOf with a {type:null} member", async () => {
      const out = await toSchema(Nullable(Type.Object({ a: Type.String() })))
      expect(out.anyOf).toBeDefined()
      expect(out.type).toBeUndefined()
      expect(out.anyOf).toContainEqual({ type: "null" })
    })

    it("leaves a nullable array as anyOf with a {type:null} member", async () => {
      const out = await toSchema(Nullable(Type.Array(Type.String())))
      expect(out.anyOf).toBeDefined()
      expect(out.anyOf).toContainEqual({ type: "null" })
    })

    it("leaves a nullable $ref as anyOf with a {type:null} member", async () => {
      const out = await toSchema(Nullable(Type.Ref("#/components/schemas/Foo")))
      expect(out.anyOf).toBeDefined()
      expect(out.anyOf).toContainEqual({ type: "null" })
    })

    it("keeps a nullable property in the parent required array", async () => {
      const out = await toSchema(
        Type.Object({ matchData: Nullable(Type.Ref("#/components/schemas/Foo")) }),
      )
      expect(out.required).toContain("matchData")
    })

    it("still collapses a nullable scalar to a type array", async () => {
      const out = await toSchema(Nullable(Type.String()))
      expect(out.type).toEqual(["string", "null"])
      expect(out.anyOf).toBeUndefined()
    })
  })

  describe('"typeArray" mode (swift-openapi-generator compatible)', () => {
    it("folds a nullable object into a type array, lifting properties/required", async () => {
      const out = await toSchema(Nullable(Type.Object({ a: Type.String() })), "typeArray")
      expect(out.anyOf).toBeUndefined()
      expect(out.type).toEqual(["object", "null"])
      expect(out.required).toEqual(["a"])
      expect(out.properties).toEqual({ a: { type: "string" } })
    })

    it("folds a nullable array into a type array, lifting items", async () => {
      const out = await toSchema(Nullable(Type.Array(Type.String())), "typeArray")
      expect(out.anyOf).toBeUndefined()
      expect(out.type).toEqual(["array", "null"])
      expect(out.items).toEqual({ type: "string" })
    })

    it("folds a nullable $ref into a bare $ref (drops the null branch)", async () => {
      const out = await toSchema(Nullable(Type.Ref("#/components/schemas/Foo")), "typeArray")
      expect(out.anyOf).toBeUndefined()
      expect(out.$ref).toBe("#/components/schemas/Foo")
      expect(JSON.stringify(out)).not.toContain('"null"')
    })

    it("drops a nullable property from the parent required array (keeps others)", async () => {
      const out = await toSchema(
        Type.Object({
          id: Type.String(),
          matchData: Nullable(Type.Ref("#/components/schemas/Foo")),
        }),
        "typeArray",
      )
      expect(out.required).toEqual(["id"])
      expect((out.properties as Record<string, unknown>).matchData).toEqual({
        $ref: "#/components/schemas/Foo",
      })
    })

    it("removes required entirely when every property is nullable", async () => {
      const out = await toSchema(
        Type.Object({ a: Nullable(Type.Object({ x: Type.String() })) }),
        "typeArray",
      )
      expect(out.required).toBeUndefined()
    })

    it("still folds a nullable scalar with format (regression)", async () => {
      const out = await toSchema(Nullable(Type.String({ format: "date-time" })), "typeArray")
      expect(out.type).toEqual(["string", "null"])
      expect(out.format).toBe("date-time")
      expect(out.anyOf).toBeUndefined()
    })

    it("leaves a union with multiple non-null members as anyOf", async () => {
      const out = await toSchema(
        Type.Union([
          Type.Object({ a: Type.String() }),
          Type.Object({ b: Type.Number() }),
          Type.Null(),
        ]),
        "typeArray",
      )
      expect(out.anyOf).toBeDefined()
      expect(out.type).toBeUndefined()
      expect(out.anyOf).toContainEqual({ type: "null" })
    })

    it("preserves union-level annotations when folding an object", async () => {
      const out = await toSchema(
        Type.Union([Type.Object({ a: Type.String() }), Type.Null()], { description: "d" }),
        "typeArray",
      )
      expect(out.type).toEqual(["object", "null"])
      expect(out.description).toBe("d")
    })
  })
})
