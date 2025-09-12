import { Hono } from "hono"
import { describeRoute } from "hono-typebox-openapi"
import { resolver, validator } from "hono-typebox-openapi/typebox"
import { Type } from "typebox"
import { ErrorSchemaResponse } from "../utils/common.serializer"
import { throwInternalServerError } from "../utils/http-exception"
import { UserPostSchemaRequest, UserPostSchemaResponse } from "./user.serialier"

const app = new Hono().post(
  "/:id",
  describeRoute({
    responses: {
      200: {
        description: "Example Response",
        content: {
          "application/json": {
            schema: resolver(UserPostSchemaResponse),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: ErrorSchemaResponse,
          },
        },
      },
    },
  }),
  validator("param", Type.Object({ id: Type.Number() })),
  validator("json", UserPostSchemaRequest),
  (c) => {
    const { id } = c.req.valid("param")
    if (Number.isNaN(id)) {
      return throwInternalServerError(c, "Example error")
    }
    const body = c.req.valid("json")
    console.log(body)

    return c.json({ id: crypto.randomUUID(), failureCount: id % 2 === 0 ? 0 : null })
  },
)

export default app
