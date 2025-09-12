import type { Env, MiddlewareHandler, ValidationTargets } from "hono"
import type { Static, TSchema } from "typebox"
import { Value } from "typebox/value"
import convert from "./toOpenAPISchema"
import type { OpenAPIRouteHandlerConfig, ResolverResult } from "./types"
import { generateValidatorDocs, uniqueSymbol } from "./utils"
import { type Hook, tbValidator } from "./validator"

/**
 * Generate a resolver for a TypeBox schema
 * @param schema TypeBox schema
 * @returns Resolver result
 */
export function resolver(schema: TSchema): ResolverResult {
  return {
    builder: async () => ({
      schema: await convert(schema),
    }),
    validator: (value) => {
      Value.Parse(schema, value)
    },
  }
}

/**
 * Create a validator middleware
 * @param target Target for validation
 * @param schema TypeBox schema
 * @param hook Hook for validation
 * @returns Middleware handler
 */
export function validator<
  T extends TSchema,
  Target extends keyof ValidationTargets,
  E extends Env,
  P extends string,
  V extends {
    in: { [K in Target]: Static<T> }
    out: { [K in Target]: Static<T> }
  },
>(target: Target, schema: T, hook?: Hook<Static<T>, E, P>): MiddlewareHandler<E, P, V> {
  const middleware = tbValidator(target, schema, hook)

  return Object.assign(middleware, {
    [uniqueSymbol]: {
      resolver: async (config: OpenAPIRouteHandlerConfig) =>
        generateValidatorDocs(target, await resolver(schema).builder(config)),
    },
  })
}
