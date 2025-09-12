import type { Context, Env, MiddlewareHandler, ValidationTargets } from "hono"
import { validator } from "hono/validator"
import type { Static, TSchema } from "typebox"
import { Compile } from "typebox/compile"
import type { TLocalizedValidationError } from "typebox/error"
import { Value } from "typebox/value"

export type Hook<T, E extends Env, P extends string> = (
  result:
    | {
        success: true
        data: T
      }
    | {
        success: false
        errors: TLocalizedValidationError[]
      },
  c: Context<E, P>,
) => Response | Promise<Response> | undefined

/**
 * Hono middleware that validates incoming data via a [TypeBox](https://github.com/sinclairzx81/typebox) schema.
 *
 * ---
 *
 * No Hook
 *
 * ```ts
 * import { tbValidator } from 'hono-typebox-openapi/validator'
 * import { Type as T } from 'typebox'
 *
 * const schema = T.Object({
 *   name: T.String(),
 *   age: T.Number(),
 * })
 *
 * const route = app.post('/user', tbValidator('json', schema), (c) => {
 *   const user = c.req.valid('json')
 *   return c.json({ success: true, message: `${user.name} is ${user.age}` })
 * })
 * ```
 *
 * ---
 * Hook
 *
 * ```ts
 * import { tbValidator } from 'hono-typebox-openapi/validator'
 * import { Type as T } from 'typebox'
 *
 * const schema = T.Object({
 *   name: T.String(),
 *   age: T.Number(),
 * })
 *
 * app.post(
 *   '/user',
 *   tbValidator('json', schema, (result, c) => {
 *     if (!result.success) {
 *       return c.text('Invalid!', 400)
 *     }
 *   })
 *   //...
 * )
 * ```
 */

export function tbValidator<
  T extends TSchema,
  Target extends keyof ValidationTargets,
  E extends Env,
  P extends string,
  V extends {
    in: Record<Target, Static<T>>
    out: Record<Target, Static<T>>
  },
>(target: Target, schema: T, hook?: Hook<Static<T>, E, P>): MiddlewareHandler<E, P, V> {
  const compiled = Compile(schema)

  // @ts-expect-error not typed well
  // Compile the provided schema once rather than per validation. This could be optimized further using a shared schema
  // compilation pool similar to the Fastify implementation.
  return validator(target, async (unprocessedData, c) => {
    const data = Value.Convert(schema, Value.Default(schema, Value.Clean(schema, unprocessedData)))

    if (compiled.Check(data)) {
      if (hook) {
        const hookResult = hook({ success: true, data }, c)
        if (hookResult instanceof Response || hookResult instanceof Promise) {
          return hookResult
        }
      }
      // @ts-expect-error - Return type
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return data
    }

    const errors = Array.from(compiled.Errors(data))
    if (hook) {
      const hookResult = hook({ success: false, errors }, c)
      if (hookResult instanceof Response || hookResult instanceof Promise) {
        return hookResult
      }
    }

    return c.json({ success: false, errors }, 400)
  })
}
