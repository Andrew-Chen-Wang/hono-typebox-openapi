import { serve } from "@hono/node-server"
import { Scalar } from "@scalar/hono-api-reference"
import { Hono } from "hono"
import { type OpenApiSpecsOptions, generateSpecs, openAPISpecs } from "hono-typebox-openapi"
import { ErrorObjectT, ErrorResponseT, InnerErrorT } from "./utils/errors/error.serializer"
import v1 from "./v1"

const spec: Partial<OpenApiSpecsOptions> = {
  documentation: {
    info: {
      title: "Internal API",
      version: "1.0.0",
      description: "Internal API",
    },
    servers: [{ url: "http://localhost:3000", description: "Local Server" }],
    components: {
      schemas: {
        InnerErrorT,
        ErrorObjectT,
        ErrorResponseT,
      },
    },
  },
}

const app = new Hono().basePath("/api")
app.get("/openapi", openAPISpecs(app, spec))
app.get(
  "/docs",
  Scalar((c) => {
    return {
      theme: "saturn",
      url: "/api/openapi",
    }
  }),
)

const routes = app.route("", v1)

// Top-level, target-specific spec endpoints used by the codegen integration tests
// (apps/codegen-integration). The path naming mirrors the private "BestFit" app:
//   /openapi      -> default (no target)
//   /openapi-ios  -> swift-openapi-generator target
// A /openapi-android (ktor target) endpoint is added only if a `ktor` target is introduced.
const root = new Hono()
root.get("/openapi", openAPISpecs(app, spec))
root.get("/openapi-ios", openAPISpecs(app, { ...spec, target: "swift-openapi-generator" }))
root.route("/", app)

export default app
export type AppType = typeof routes

// Default to a high port: low ports (e.g. 3000/3001) are taken by the BestFit dev app and its
// OpenAPI server on dev machines. Override with PORT. The codegen integration tests read the
// same default (CODEGEN_LOCAL_URL in apps/codegen-integration/src/helpers.ts).
const DEFAULT_PORT = 34100

if (process.argv.includes("--openapi")) {
  const specs = generateSpecs(app, spec).then((specs) => {
    console.log(JSON.stringify(specs, null, 2))
  })
} else {
  serve({
    fetch: root.fetch,
    port: Number(process.env.PORT ?? DEFAULT_PORT),
  })
}
