import { apiReference } from "@scalar/hono-api-reference"
import { Hono } from "hono"
import { type GenerateSpecOptions, generateSpecs, openAPIRouteHandler } from "hono-openapi"
import { ErrorObjectT, ErrorResponseT, InnerErrorT } from "./utils/errors/error.serializer.ts"
import v1 from "./v1"

const spec: Partial<GenerateSpecOptions> = {
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
if (process.env.NODE_ENV === "development") {
  app.get("/openapi", openAPIRouteHandler(app, spec))
  app.get(
    "/docs",
    apiReference({
      theme: "saturn",
      spec: { url: "/api/openapi" },
    }),
  )
}

const routes = app.route("", v1)

export default app
export type AppType = typeof routes

if (process.argv.includes("--openapi")) {
  const specs = generateSpecs(app, spec).then((specs) => {
    console.log(JSON.stringify(specs, null, 2))
  })
}
