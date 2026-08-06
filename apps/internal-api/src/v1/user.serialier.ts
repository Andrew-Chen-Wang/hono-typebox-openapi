import { Type } from "typebox"
import { Nullable } from "../utils/common.serializer"

export const UserPostSchemaRequest = Type.Object({
  id: Type.Number(),
  // Required + nullable on a REQUEST body: `null` is a meaningful value ("clear it"), distinct
  // from omission, which the server rejects. Exercises the encode path in generated clients.
  vote: Nullable(Type.Boolean()),
})

export const UserPostSchemaResponse = Type.Object({
  id: Type.String({ format: "uuid" }),
  // A required + nullable field: it must stay in `required` (the server demands it) while its
  // schema still permits null. Exercises that live codegen accepts `type: [..., "null"]` on a
  // required property instead of dropping it.
  failureCount: Nullable(Type.Number()),
  // Tuples must reach the generators as 2020-12 `prefixItems`; draft-07 array-form `items` makes
  // OpenAPIKit throw while parsing, failing every operation in the document.
  point: Type.Tuple([Type.Number(), Type.Number()]),
  extent: Nullable(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])),
})
