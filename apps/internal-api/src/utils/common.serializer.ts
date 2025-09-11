import {
  FormatRegistry,
  type Static,
  type StaticEncode,
  type TSchema,
  type TTransform,
  Type,
} from "@sinclair/typebox"
import { DefaultErrorFunction, SetErrorFunction } from "@sinclair/typebox/errors"
import { ErrorSchemaResponse } from "./errors/error.serializer"

export type RefineFunction<T extends TSchema> = (value: StaticEncode<T>) => boolean
export type RefineOptions = { message?: string }

/**
 * Refine a schema with a custom check function
 * https://github.com/sinclairzx81/typebox/issues/816#issuecomment-2028474495
 *
 * Example:
 * ```typescript
 * const T = Refine(Type.String(), value => value.length <= 255, {
 *   message: "String can't be more than 255 characters"
 * })
 * ```
 */
export function Refine<T extends TSchema, E = StaticEncode<T>>(
  schema: T,
  refine: RefineFunction<T>,
  options: RefineOptions = {},
): TTransform<T, E> {
  const Throw = (options: RefineOptions): never => {
    throw new Error(options.message ?? "Refine check failed")
  }
  const Assert = (value: E): E => (refine(value) ? value : Throw(options))
  return Type.Transform(schema)
    .Decode((value) => Assert(value as E))
    .Encode((value) => Assert(value))
}

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
SetErrorFunction((parameter) =>
  "errorMessage" in parameter.schema
    ? (parameter.schema.errorMessage as string)
    : DefaultErrorFunction(parameter),
)

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
