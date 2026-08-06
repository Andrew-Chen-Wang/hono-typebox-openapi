import { type TSchema, Type } from "typebox"
import { describe, expect, it } from "vitest"
import convert from "./toOpenAPISchema"

// Mirrors the `Nullable` helper used by consumers: `Type.Union([T, Type.Null()])`,
// which TypeBox emits as `anyOf: [<schema>, { type: "null" }]`.
const Nullable = <T extends TSchema>(T: T) => Type.Union([T, Type.Null()])

// `convert` is typed to return an OpenAPI Document; for these schema-level assertions we
// view the result as a plain JSON Schema record. `swiftGenerator` selects the
// `target: "swift-openapi-generator"` normalization; omitted = default 3.1 output.
type SchemaRecord = Record<string, unknown>
// Whether an emitted schema can still hold `null` — a type array containing "null", or an empty
// schema, which permits anything.
const canExpressNull = (s: SchemaRecord) =>
  s.type === "null" ||
  (Array.isArray(s.type) && s.type.includes("null")) ||
  Object.keys(s).length === 0

const toSchema = async (schema: TSchema, swiftGenerator?: boolean): Promise<SchemaRecord> =>
  (await convert(
    schema,
    swiftGenerator ? { target: "swift-openapi-generator" } : undefined,
  )) as unknown as SchemaRecord

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

  describe('target: "swift-openapi-generator"', () => {
    it("folds a nullable object into a type array, lifting properties/required", async () => {
      const out = await toSchema(Nullable(Type.Object({ a: Type.String() })), true)
      expect(out.anyOf).toBeUndefined()
      expect(out.type).toEqual(["object", "null"])
      expect(out.required).toEqual(["a"])
      expect(out.properties).toEqual({ a: { type: "string" } })
    })

    it("folds a nullable array into a type array, lifting items", async () => {
      const out = await toSchema(Nullable(Type.Array(Type.String())), true)
      expect(out.anyOf).toBeUndefined()
      expect(out.type).toEqual(["array", "null"])
      expect(out.items).toEqual({ type: "string" })
    })

    it("folds a nullable $ref into a bare $ref (drops the null branch)", async () => {
      const out = await toSchema(Nullable(Type.Ref("#/components/schemas/Foo")), true)
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
        true,
      )
      expect(out.required).toEqual(["id"])
      expect((out.properties as Record<string, unknown>).matchData).toEqual({
        $ref: "#/components/schemas/Foo",
      })
    })

    // A nullable object folds to `type: ["object","null"]`, which still says "null" — so the
    // property stays required, matching what the server actually enforces. Un-requiring it would
    // advertise "you may omit this" against a server that answers 400 for an absent field.
    it("keeps a required nullable object in required (its null branch survives)", async () => {
      const out = await toSchema(
        Type.Object({ a: Nullable(Type.Object({ x: Type.String() })) }),
        true,
      )
      expect(out.required).toEqual(["a"])
      expect((out.properties as Record<string, SchemaRecord>).a.type).toEqual(["object", "null"])
    })

    // The converse: a nullable $ref collapses to a bare `$ref`, which cannot carry a type array.
    // Absence from `required` is the only nullability signal left, so it must be removed.
    it("removes required entirely when the only property loses its null branch", async () => {
      const out = await toSchema(
        Type.Object({ a: Nullable(Type.Ref("#/components/schemas/Foo")) }),
        true,
      )
      expect(out.required).toBeUndefined()
    })

    it("still folds a nullable scalar with format (regression)", async () => {
      const out = await toSchema(Nullable(Type.String({ format: "date-time" })), true)
      expect(out.type).toEqual(["string", "null"])
      expect(out.format).toBe("date-time")
      expect(out.anyOf).toBeUndefined()
    })

    it("drops the null member from a union with multiple non-null members", async () => {
      // swift-openapi-generator cannot consume a {type:null} member even in a multi-member
      // union, so the swift target strips it and keeps the remaining members as anyOf.
      const out = await toSchema(
        Type.Union([
          Type.Object({ a: Type.String() }),
          Type.Object({ b: Type.Number() }),
          Type.Null(),
        ]),
        true,
      )
      expect(out.anyOf).toBeDefined()
      expect(out.type).toBeUndefined()
      expect(out.anyOf).not.toContainEqual({ type: "null" })
      expect((out.anyOf as unknown[]).length).toBe(2)
    })

    it("preserves union-level annotations when folding an object", async () => {
      const out = await toSchema(
        Type.Union([Type.Object({ a: Type.String() }), Type.Null()], { description: "d" }),
        true,
      )
      expect(out.type).toEqual(["object", "null"])
      expect(out.description).toBe("d")
    })
  })
})

// TypeBox 1.x emits tuples in draft-07 form (`items: [...]` + `additionalItems`), which is not a
// tuple under JSON Schema 2020-12 / OpenAPI 3.1 — OpenAPIKit rejects the document outright and
// lenient readers degrade the field to `Array<unknown>`. Conversion must re-express it as
// `prefixItems`, on both targets.
describe("tuples", () => {
  const props = (out: SchemaRecord) => out.properties as Record<string, SchemaRecord>

  it.each([[undefined], [true]])("lifts a tuple to prefixItems (swift=%s)", async (swift) => {
    const out = await toSchema(Type.Tuple([Type.Number(), Type.Number()]), swift)
    expect(out.prefixItems).toEqual([{ type: "number" }, { type: "number" }])
    expect(out.minItems).toBe(2)
    // `additionalItems: false` closes a tuple in draft-07; `maxItems` is how 2020-12 says it.
    expect(out.maxItems).toBe(2)
    expect(out.items).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain("additionalItems")
  })

  it("keeps prefixItems on a nullable tuple in the default target", async () => {
    const out = await toSchema(Nullable(Type.Tuple([Type.Number(), Type.Number()])))
    const [tuple] = out.anyOf as SchemaRecord[]
    expect(tuple.prefixItems).toHaveLength(2)
    expect(tuple.items).toBeUndefined()
    expect(out.anyOf).toContainEqual({ type: "null" })
  })

  // The swift target folds the tuple member onto the parent via `liftMemberAsNullable`, carrying
  // the member's raw array-form `items` with it — so the lift has to run after that fold.
  it("keeps prefixItems when the swift target folds a nullable tuple", async () => {
    const four = Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])
    const out = await toSchema(Nullable(four), true)
    expect(out.type).toEqual(["array", "null"])
    expect(out.prefixItems).toHaveLength(4)
    expect(out.maxItems).toBe(4)
    expect(out.items).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain("additionalItems")
  })

  it.each([[undefined], [true]])("reaches a nested tuple (swift=%s)", async (swift) => {
    const out = await toSchema(
      Type.Array(Type.Object({ bbox: Type.Tuple([Type.Number(), Type.Number()]) })),
      swift,
    )
    const bbox = props(out.items as SchemaRecord).bbox
    expect(bbox.prefixItems).toHaveLength(2)
    expect(bbox.items).toBeUndefined()
  })

  // Regression guard for the walker vocabulary: json-schema-walker's DRAFT_07 has no
  // `prefixItems` handler, so without one the walk stops at a lifted tuple and its members are
  // never normalized — this nullable member would keep its swift-incompatible {type:"null"}.
  it("still converts schemas inside a lifted tuple", async () => {
    const out = await toSchema(
      Type.Tuple([Nullable(Type.Number()), Type.Object({ a: Type.String() })]),
      true,
    )
    const [first] = out.prefixItems as SchemaRecord[]
    expect(first.type).toEqual(["number", "null"])
    expect(JSON.stringify(out)).not.toContain('{"type":"null"}')
  })

  // 2020-12 requires `prefixItems` to be non-empty, so an empty tuple is just "no elements",
  // said with `maxItems: 0`. The open `items: {}` the array guard then fills in is unreachable
  // for a zero-length array, and swift-openapi-generator wants an `items` on every array.
  it("emits an empty tuple as maxItems 0 with no prefixItems", async () => {
    const out = await toSchema(Type.Tuple([]), true)
    expect(out.prefixItems).toBeUndefined()
    expect(out.maxItems).toBe(0)
    expect(out.items).toEqual({})
  })

  it("leaves a plain array's object-form items untouched", async () => {
    const out = await toSchema(Type.Array(Type.Number()))
    expect(out.items).toEqual({ type: "number" })
    expect(out.prefixItems).toBeUndefined()
    expect(out.maxItems).toBeUndefined()
  })

  it("still fills in items:{} for an array with no items", async () => {
    const out = await toSchema({ type: "array" } as unknown as TSchema)
    expect(out.items).toEqual({})
  })
})

// A nullable property may leave `required` ONLY when normalization could not preserve its null
// branch. Un-requiring one that still says "null" advertises "you may omit this" against a server
// that validates the untransformed TypeBox schema and answers 400 for an absent field.
describe("required nullable properties (swift target)", () => {
  const props = (out: SchemaRecord) => out.properties as Record<string, SchemaRecord>

  it("keeps a required nullable scalar in required", async () => {
    const out = await toSchema(
      Type.Object({ id: Type.String(), vote: Nullable(Type.Boolean()) }),
      true,
    )
    expect(out.required).toEqual(["id", "vote"])
    expect(props(out).vote.type).toEqual(["boolean", "null"])
  })

  it("keeps required nullable objects and arrays in required", async () => {
    const out = await toSchema(
      Type.Object({
        obj: Nullable(Type.Object({ a: Type.String() })),
        arr: Nullable(Type.Array(Type.String())),
      }),
      true,
    )
    expect(out.required).toEqual(["obj", "arr"])
  })

  it("keeps a required nullable tuple in required", async () => {
    const out = await toSchema(
      Type.Object({ point: Nullable(Type.Tuple([Type.Number(), Type.Number()])) }),
      true,
    )
    expect(out.required).toEqual(["point"])
    expect(props(out).point.prefixItems).toHaveLength(2)
  })

  // The load-bearing cases: each of these erases the null branch, so absence from `required` is
  // the only nullability signal swift-openapi-generator has left.
  it("drops properties whose null branch could not be preserved", async () => {
    const out = await toSchema(
      Type.Object({
        keep: Nullable(Type.String()),
        ref: Nullable(Type.Ref("#/components/schemas/Foo")),
        literal: Nullable(Type.Union([Type.Literal("a"), Type.Literal("b")])),
        multi: Type.Union([Type.Object({ a: Type.String() }), Type.Number(), Type.Null()]),
      }),
      true,
    )
    expect(out.required).toEqual(["keep"])
  })

  it("reports the pointers it un-required", async () => {
    const seen: string[][] = []
    await convert(
      Type.Object({
        keep: Nullable(Type.String()),
        ref: Nullable(Type.Ref("#/components/schemas/Foo")),
      }),
      { target: "swift-openapi-generator", onUnrequiredNullable: (p) => seen.push(p) },
    )
    expect(seen).toEqual([["/properties/ref"]])
  })

  it("does not report anything when nothing was un-required", async () => {
    const seen: string[][] = []
    await convert(Type.Object({ vote: Nullable(Type.Boolean()) }), {
      target: "swift-openapi-generator",
      onUnrequiredNullable: (p) => seen.push(p),
    })
    expect(seen).toEqual([])
  })

  it("never leaks the internal marker into the emitted schema", async () => {
    const out = await toSchema(
      Type.Object({ ref: Nullable(Type.Ref("#/components/schemas/Foo")) }),
      true,
    )
    expect(Object.getOwnPropertySymbols(props(out).ref)).toEqual([])
  })

  // The invariant, checked against what was actually emitted rather than against a prediction of
  // it: no pass may un-require a property whose emitted schema can still hold null. The large
  // const union is included deliberately — `collapseLargeConstUnion` is the pass most likely to
  // restructure a shape between classification and emission.
  it("only un-requires properties whose emitted schema cannot express null", async () => {
    const shapes: Record<string, TSchema> = {
      scalar: Nullable(Type.String()),
      formatted: Nullable(Type.String({ format: "date-time" })),
      object: Nullable(Type.Object({ a: Type.String() })),
      array: Nullable(Type.Array(Type.String())),
      tuple: Nullable(Type.Tuple([Type.Number(), Type.Number()])),
      ref: Nullable(Type.Ref("#/components/schemas/Foo")),
      smallConst: Nullable(Type.Union([Type.Literal("a"), Type.Literal("b")])),
      largeConst: Nullable(Type.Union(Array.from({ length: 25 }, (_, i) => Type.Literal(`v${i}`)))),
      multi: Type.Union([Type.Object({ a: Type.String() }), Type.Number(), Type.Null()]),
      standaloneNull: Type.Null(),
      notNullable: Type.Union([Type.String(), Type.Number()]),
    }

    const out = await toSchema(Type.Object(shapes), true)
    const required = new Set((out.required as string[] | undefined) ?? [])

    // One-directional: a property that was never nullable (`notNullable`) is legitimately both
    // required and unable to hold null. What must never happen is the reverse — a property
    // dropped from `required` while its emitted schema still accepts null.
    const unrequiredButNullable = Object.keys(shapes).filter(
      (name) => !required.has(name) && canExpressNull(props(out)[name]),
    )
    expect(unrequiredButNullable, JSON.stringify(props(out), null, 2)).toEqual([])
  })
})
