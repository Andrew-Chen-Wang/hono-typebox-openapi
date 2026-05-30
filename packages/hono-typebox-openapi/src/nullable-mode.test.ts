import { Hono } from "hono"
import { type TSchema, Type } from "typebox"
import { describe, expect, it } from "vitest"
import { generateSpecs } from "./openapi"
import { describeRoute } from "./route"
import { resolver } from "./typebox"

const Nullable = <T extends TSchema>(T: T) => Type.Union([T, Type.Null()])

const ResponseSchema = Type.Object({
  id: Type.String(),
  jobDetails: Nullable(Type.Object({ company: Type.String() })),
  tags: Nullable(Type.Array(Type.String())),
  matchData: Nullable(Type.Ref("#/components/schemas/Foo")),
})

function makeApp() {
  return new Hono().get(
    "/user",
    describeRoute({
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
      },
    }),
    (c) => c.json({}),
  )
}

// Pull the response schema object out of the generated spec.
// biome-ignore lint/suspicious/noExplicitAny: test helper digging into the spec
function responseSchema(spec: any) {
  return spec.paths["/user"].get.responses["200"].content["application/json"].schema
}

describe("nullableMode end-to-end via generateSpecs", () => {
  it('default ("anyOf") keeps {type:null} members — unchanged for web clients', async () => {
    const spec = await generateSpecs(makeApp())
    const s = responseSchema(spec)
    expect(s.properties.jobDetails.anyOf).toContainEqual({ type: "null" })
    expect(s.properties.tags.anyOf).toContainEqual({ type: "null" })
    expect(s.properties.matchData.anyOf).toContainEqual({ type: "null" })
    expect(s.required).toContain("jobDetails")
  })

  it('"typeArray" emits swift-compatible shapes and no standalone {type:null}', async () => {
    const spec = await generateSpecs(makeApp(), { nullableMode: "typeArray" })
    const s = responseSchema(spec)
    expect(s.properties.jobDetails.type).toEqual(["object", "null"])
    expect(s.properties.tags.type).toEqual(["array", "null"])
    expect(s.properties.matchData).toEqual({ $ref: "#/components/schemas/Foo" })
    // nullable props dropped from required (id stays)
    expect(s.required).toEqual(["id"])
    // No standalone {"type":"null"} member anywhere (the shape swift drops). Note `"null"`
    // legitimately appears inside type arrays like ["object","null"] — that is the fix.
    expect(JSON.stringify(s)).not.toContain('{"type":"null"}')
  })
})
