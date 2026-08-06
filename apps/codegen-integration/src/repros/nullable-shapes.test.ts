// Regression guards for the OpenAPI shapes that break Apple's swift-openapi-generator.
//
// swift-openapi-generator cannot consume a standalone `{ "type": "null" }` member inside an
// `anyOf`/`oneOf` (or a standalone null schema): it logs `Schema "..." is not supported ...
// skipping` and SILENTLY DROPS the property from the generated client. The library's
// `target: "swift-openapi-generator"` is supposed to rewrite every nullable shape into a form
// the generator accepts (type arrays, lifted object/array branches, bare `$ref`, etc.).
//
// Each case below is a NARROW, SYNTHETIC reproduction of a nullable shape category seen in a
// large real-world spec — modeled abstractly with generic field names, copying no real schema.
// They assert the swift target leaves NO swift-incompatible null shape, so this compatibility
// can never silently regress. (The matching live end-to-end check is swift-openapi-generator.test.ts.)
import { Hono } from "hono"
import { describeRoute, generateSpecs } from "hono-typebox-openapi"
import { resolver } from "hono-typebox-openapi/typebox"
import { type TSchema, Type } from "typebox"
import { describe, expect, it } from "vitest"

const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()])
const Sub = Type.Object({ a: Type.String(), b: Type.Number() })

function describeRouteFor(schema: TSchema) {
  return describeRoute({
    responses: {
      200: { description: "ok", content: { "application/json": { schema: resolver(schema) } } },
    },
  })
}

async function swiftSchema(schema: TSchema) {
  const app = new Hono().get("/probe", describeRouteFor(schema), (c) => c.json({}))
  const spec = await generateSpecs(app, { target: "swift-openapi-generator" })
  return (spec as any).paths["/probe"].get.responses["200"].content["application/json"].schema
}

const isNullMember = (m: unknown) =>
  !!m && typeof m === "object" && (m as Record<string, unknown>).type === "null"

// Recursively detect any shape swift-openapi-generator would skip.
function swiftIncompatibleNulls(node: unknown, path = "$"): string[] {
  const bad: string[] = []
  if (!node || typeof node !== "object") return bad
  if (Array.isArray(node)) {
    node.forEach((v, i) => bad.push(...swiftIncompatibleNulls(v, `${path}[${i}]`)))
    return bad
  }
  const obj = node as Record<string, unknown>
  if (obj.type === "null") bad.push(`${path}: standalone {type:"null"}`)
  for (const key of ["anyOf", "oneOf"] as const) {
    const arr = obj[key]
    if (Array.isArray(arr) && arr.some(isNullMember)) {
      bad.push(`${path}.${key}: contains a {type:"null"} member`)
    }
  }
  for (const k of Object.keys(obj)) bad.push(...swiftIncompatibleNulls(obj[k], `${path}.${k}`))
  return bad
}

// Recursively detect draft-07 tuples — an array-form `items`. OpenAPI 3.1 is JSON Schema 2020-12,
// where a tuple is `prefixItems`; array-form `items` makes OpenAPIKit throw while parsing the
// document, so every operation in the spec fails to generate.
function draft07Tuples(node: unknown, path = "$"): string[] {
  const bad: string[] = []
  if (!node || typeof node !== "object") return bad
  if (Array.isArray(node)) {
    node.forEach((v, i) => bad.push(...draft07Tuples(v, `${path}[${i}]`)))
    return bad
  }
  const obj = node as Record<string, unknown>
  if (Array.isArray(obj.items)) bad.push(`${path}.items: draft-07 array-form tuple`)
  if (obj.additionalItems !== undefined) bad.push(`${path}: draft-07 additionalItems`)
  if (obj["x-additionalItems"] !== undefined) bad.push(`${path}: leaked x-additionalItems`)
  for (const k of Object.keys(obj)) bad.push(...draft07Tuples(obj[k], `${path}.${k}`))
  return bad
}

// Every nullable shape category, mirroring those a complex real-world spec exercises.
const cases: Record<string, TSchema> = {
  "nullable string (scalar)": Type.Object({ f: Nullable(Type.String()) }),
  "nullable integer (scalar)": Type.Object({ f: Nullable(Type.Integer()) }),
  "nullable boolean (scalar)": Type.Object({ f: Nullable(Type.Boolean()) }),
  "nullable object with properties": Type.Object({ f: Nullable(Sub) }),
  "nullable open object (record)": Type.Object({
    f: Nullable(Type.Record(Type.String(), Type.String())),
  }),
  "nullable array": Type.Object({ f: Nullable(Type.Array(Type.String())) }),
  "nullable array of objects": Type.Object({ f: Nullable(Type.Array(Sub)) }),
  "mixed multi-type union with null": Type.Object({
    f: Type.Union([
      Type.String(),
      Type.Number(),
      Type.Boolean(),
      Type.Array(Type.String()),
      Type.Null(),
    ]),
  }),
  "standalone null property": Type.Object({ f: Type.Null() }),
  "nullable object nested under an object property": Type.Object({
    outer: Type.Object({ f: Nullable(Type.String()) }),
  }),
  "nullable object inside array items": Type.Object({
    list: Type.Array(Type.Object({ f: Nullable(Sub) })),
  }),
  "nullable value inside a record": Type.Record(Type.String(), Nullable(Sub)),
  "nullable tuple": Type.Object({ f: Nullable(Type.Tuple([Type.Number(), Type.Number()])) }),
  "tuple nested under array items": Type.Object({
    list: Type.Array(Type.Object({ bbox: Type.Tuple([Type.Number(), Type.Number()]) })),
  }),
  "tuple with a nullable member": Type.Object({
    f: Type.Tuple([Nullable(Type.Number()), Type.String()]),
  }),
}

describe("swift target eliminates every swift-incompatible null shape", () => {
  it.each(Object.entries(cases))("%s", async (_name, schema) => {
    const out = await swiftSchema(schema)
    const bad = swiftIncompatibleNulls(out)
    expect(bad, `produced shapes swift-openapi-generator would skip:\n${bad.join("\n")}`).toEqual(
      [],
    )
  })

  it("nullable $ref collapses to a bare $ref (carried as optional via required)", async () => {
    const app = new Hono().get(
      "/probe",
      describeRouteFor(Type.Object({ ref: Nullable(Type.Ref("#/components/schemas/Sub")) })),
      (c) => c.json({}),
    )
    const spec = await generateSpecs(app, { target: "swift-openapi-generator" })
    const s = (spec as any).paths["/probe"].get.responses["200"].content["application/json"].schema
    expect(s.properties.ref).toEqual({ $ref: "#/components/schemas/Sub" })
    expect(s.required ?? []).not.toContain("ref")
    expect(swiftIncompatibleNulls(s)).toEqual([])
  })

  // A property whose emitted schema still says "null" must stay required. Un-requiring it makes
  // the document advertise "may be omitted" while the server, validating the untransformed
  // TypeBox schema, answers 400 — the mismatch this guard exists to prevent.
  it("keeps required-nullable properties in required", async () => {
    const app = new Hono().get(
      "/probe",
      describeRouteFor(
        Type.Object({
          vote: Nullable(Type.Boolean()),
          image: Nullable(Type.String()),
          ref: Nullable(Type.Ref("#/components/schemas/Sub")),
        }),
      ),
      (c) => c.json({}),
    )
    const spec = await generateSpecs(app, { target: "swift-openapi-generator" })
    const s = (spec as any).paths["/probe"].get.responses["200"].content["application/json"].schema
    expect(s.required).toEqual(["vote", "image"])
  })
})

// Both targets must speak 2020-12 tuples. A draft-07 tuple anywhere in the document breaks the
// entire Swift build, not just the operation that carries it.
describe("tuples are emitted as 2020-12 prefixItems", () => {
  const tupleCases: Record<string, TSchema> = {
    "bare tuple": Type.Object({ point: Type.Tuple([Type.Number(), Type.Number()]) }),
    "nullable tuple": Type.Object({ extent: Nullable(Type.Tuple([Type.Number(), Type.Number()])) }),
    "tuple nested under array items": Type.Object({
      list: Type.Array(Type.Object({ bbox: Type.Tuple([Type.Number(), Type.Number()]) })),
    }),
  }

  it.each(Object.entries(tupleCases))("swift target: %s", async (_name, schema) => {
    const bad = draft07Tuples(await swiftSchema(schema))
    expect(bad, `draft-07 tuple syntax in a 3.1 document:\n${bad.join("\n")}`).toEqual([])
  })

  it.each(Object.entries(tupleCases))("default target: %s", async (_name, schema) => {
    const app = new Hono().get("/probe", describeRouteFor(schema), (c) => c.json({}))
    const spec = await generateSpecs(app)
    const s = (spec as any).paths["/probe"].get.responses["200"].content["application/json"].schema
    const bad = draft07Tuples(s)
    expect(bad, `draft-07 tuple syntax in a 3.1 document:\n${bad.join("\n")}`).toEqual([])
  })
})

describe("default target keeps idiomatic anyOf null (unchanged for web clients)", () => {
  it("nullable object stays anyOf:[..,{type:null}] without a target", async () => {
    const app = new Hono().get("/probe", describeRouteFor(Type.Object({ f: Nullable(Sub) })), (c) =>
      c.json({}),
    )
    const spec = await generateSpecs(app)
    const s = (spec as any).paths["/probe"].get.responses["200"].content["application/json"].schema
    expect(s.properties.f.anyOf).toContainEqual({ type: "null" })
    expect(s.required).toContain("f")
  })
})
