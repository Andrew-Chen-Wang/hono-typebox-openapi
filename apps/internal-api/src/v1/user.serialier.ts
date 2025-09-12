import { Type } from "typebox"
import { Nullable } from "../utils/common.serializer"

export const UserPostSchemaRequest = Type.Object({
  id: Type.Number(),
})

export const UserPostSchemaResponse = Type.Object({
  id: Type.String({ format: "uuid" }),
  failureCount: Nullable(Type.Number()),
})
