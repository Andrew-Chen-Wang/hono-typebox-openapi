import type { Context, Env, Input } from "hono"
import type { BlankInput } from "hono/types"
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status"
import type { OpenAPIV3_1 } from "openapi-types"
import type { ALLOWED_METHODS } from "./helper"

export type HasUndefined<T> = undefined extends T ? true : false
export type PromiseOr<T> = T | Promise<T>

export type OpenAPIRouteHandlerConfig = {
  version: "3.1.0" | "3.1.1"
  components: OpenAPIV3_1.ComponentsObject["schemas"]
  target?: OpenApiTarget
} & { [key: string]: unknown }

/**
 * The downstream OpenAPI consumer to tailor the generated document for. When set, the
 * document is normalized to work around that tool's limitations. Leave unset for the
 * default, spec-idiomatic OpenAPI 3.1 output (best for most tools, e.g. hey-api).
 */
export type OpenApiTarget = "swift-openapi-generator"

export type ResolverResult = {
  builder: (options?: OpenAPIRouteHandlerConfig) => PromiseOr<{
    schema: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject
    components?: OpenAPIV3_1.ComponentsObject["schemas"]
  }>
  validator: (values: unknown) => PromiseOr<void>
}

export type HandlerResponse = {
  resolver: (
    config: OpenAPIRouteHandlerConfig,
    defaultOptions?: DescribeRouteOptions,
  ) => PromiseOr<{
    docs: OpenAPIV3_1.OperationObject
    components?: OpenAPIV3_1.ComponentsObject["schemas"]
  }>
  metadata?: Record<string, unknown>
}

export type DescribeRouteOptions = Omit<OpenAPIV3_1.OperationObject, "responses" | "parameters"> & {
  /**
   * Pass `true` to hide route from OpenAPI/swagger document
   */
  hide?:
    | boolean
    | (<E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
        c: Context<E, P, I>,
      ) => boolean)

  /**
   * Validate response of the route
   */
  validateResponse?:
    | boolean
    | {
        status: ClientErrorStatusCode | ServerErrorStatusCode
        message?: string
      }

  /**
   * Responses of the request
   */
  responses?: {
    [key: string]:
      | (OpenAPIV3_1.ResponseObject & {
          content?: {
            [key: string]: Omit<OpenAPIV3_1.MediaTypeObject, "schema"> & {
              schema?: OpenAPIV3_1.ReferenceObject | OpenAPIV3_1.SchemaObject | ResolverResult
            }
          }
        })
      | OpenAPIV3_1.ReferenceObject
  }

  /**
   * Parameters of the request
   */
  parameters?: (
    | OpenAPIV3_1.ParameterObject
    | (OpenAPIV3_1.ParameterObject & {
        schema: ResolverResult
      })
  )[]
}

export interface OpenAPIRoute {
  path: string
  method: (typeof ALLOWED_METHODS)[number] | "ALL"
  data?: DescribeRouteOptions | Pick<OpenAPIV3_1.OperationObject, "parameters" | "requestBody">
}

export type OpenApiSpecsOptions = {
  /**
   * Customize OpenAPI config, refers to Swagger 2.0 config
   *
   * @see https://swagger.io/specification/v2/
   */
  documentation?: Omit<
    Partial<OpenAPIV3_1.Document>,
    "x-express-openapi-additional-middleware" | "x-express-openapi-validation-strict"
  >

  /**
   * Include paths which don't have the handlers.
   * This is useful when you want to document the
   * API without implementing it or index all the paths.
   */
  includeEmptyPaths?: boolean

  /**
   * Determine if Swagger should exclude static files.
   *
   * @default true
   */
  excludeStaticFile?: boolean

  /**
   * Paths to exclude from OpenAPI endpoint
   *
   * @default []
   */
  exclude?: string | RegExp | Array<string | RegExp>

  /**
   * Exclude methods from Open API
   */
  excludeMethods?: (typeof ALLOWED_METHODS)[number][]

  /**
   * Exclude tags from OpenAPI
   */
  excludeTags?: string[]

  /**
   * Tailor the generated OpenAPI 3.1 document for a specific downstream consumer.
   *
   * Unset (default): idiomatic 3.1 output — nullables as `anyOf: [<schema>, { type: "null" }]`
   * — handled correctly by most tooling (e.g. hey-api). Leave it unset for web clients.
   *
   * `"swift-openapi-generator"`: normalize the document for Apple's swift-openapi-generator,
   * which cannot consume a standalone `{ type: "null" }` member inside `anyOf`/`oneOf` (it
   * silently DROPS the property) and explodes large `const` string unions into hundreds of
   * single-case enums. In this mode nullables fold into `type: [..., "null"]` (or a bare
   * `$ref`), standalone null becomes an open optional, nullable props are dropped from
   * `required`, and large `const` unions collapse to `{ type: "string" }`. Note: nullable
   * properties become optional (`T?`) in generated clients under this target.
   */
  target?: OpenApiTarget

  /**
   * Default options for `describeRoute` method
   */
  defaultOptions?: Partial<Record<(typeof ALLOWED_METHODS)[number] | "ALL", DescribeRouteOptions>>
}
