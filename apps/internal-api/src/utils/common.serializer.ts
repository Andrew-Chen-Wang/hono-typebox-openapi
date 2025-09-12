import { type TSchema, Type } from "typebox"
import FormatRegistry from "typebox/format"
import { ErrorSchemaResponse } from "./errors/error.serializer"

// Common Types

export const UUID7String = Type.String({
  $id: "UUID7String",
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$",
  errorMessage: "The string must be a valid UUID",
})

export const UUID4String = Type.String({
  $id: "UUID4String",
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$",
  errorMessage: "The string must be a valid UUID",
})

export const Nullable = <T extends TSchema>(T: T) => {
  return Type.Union([T, Type.Null()])
}

export const IdParamT = Type.Object({
  id: UUID7String,
})

export const EmptyObject = Type.Object({})

export { ErrorSchemaResponse }

// Typebox Helpers
FormatRegistry.Set("email", (value) =>
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
    value,
  ),
)
FormatRegistry.Set("date-time", (value) =>
  /^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-2])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24\:?00)([\.,]\d+(?!:))?)?(\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$/.test(
    value,
  ),
)
FormatRegistry.Set("uri", (value) =>
  /^[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(
    value,
  ),
)
