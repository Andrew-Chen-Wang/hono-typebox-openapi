import { HTTPException } from "hono/http-exception"
import type { MiddlewareHandler } from "hono/types"
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status"
import type { DescribeRouteOptions, OpenAPIRouteHandlerConfig } from "./types"
import { uniqueSymbol } from "./utils"

/**
 * Describe a route with OpenAPI specs.
 * @param specs Options for describing a route
 * @returns Middleware handler
 */
export function describeRoute(specs: DescribeRouteOptions): MiddlewareHandler {
  const { validateResponse, ...docs } = specs

  const middleware: MiddlewareHandler = async (c, next) => {
    await next()

    if (validateResponse && specs.responses) {
      const status = c.res.status
      const contentType = c.res.headers.get("content-type")

      if (status && contentType) {
        const response = specs.responses[status]
        if (response && "content" in response && response.content) {
          const splitedContentType = contentType.split(";")[0]
          const content = response.content[splitedContentType]

          if (content.schema && "validator" in content.schema) {
            try {
              let data: unknown
              const clonedRes = c.res.clone()

              if (splitedContentType === "application/json") {
                data = await clonedRes.json()
              } else if (splitedContentType === "text/plain") {
                data = await clonedRes.text()
              }

              if (!data) throw new Error("No data to validate!")

              await content.schema.validator(data)
            } catch (error) {
              let httpExceptionOptions: {
                status: ClientErrorStatusCode | ServerErrorStatusCode
                message: string
              } = {
                status: 500,
                message: "Response validation failed!",
              }

              if (typeof validateResponse === "object") {
                httpExceptionOptions = {
                  ...httpExceptionOptions,
                  ...validateResponse,
                }
              }

              throw new HTTPException(httpExceptionOptions.status, {
                message: httpExceptionOptions.message,
                cause: error,
              })
            }
          }
        }
      }
    }
  }

  return Object.assign(middleware, {
    [uniqueSymbol]: {
      resolver: (config: OpenAPIRouteHandlerConfig, defaultOptions?: DescribeRouteOptions) =>
        generateRouteSpecs(config, docs, defaultOptions),
    },
  })
}

/**
 * Generate OpenAPI specs for the given route
 * @param config Route handler configuration
 * @param docs Route description in OpenAPI specs
 * @param defaultOptions Default options for describing a route
 */
export async function generateRouteSpecs(
  config: OpenAPIRouteHandlerConfig,
  docs: DescribeRouteOptions,
  defaultOptions: DescribeRouteOptions = {},
) {
  let components = {}
  const tmp = {
    ...defaultOptions,
    ...docs,
    responses: {
      ...defaultOptions.responses,
      ...docs.responses,
    },
  }

  if (tmp.responses) {
    // `docs` is captured in the describeRoute closure and reused across every
    // generateSpecs call on the same app. The spreads above are shallow, so each
    // response/content/schema below is still shared with `docs`. Resolving a
    // `builder` schema must NOT mutate those shared objects in place — otherwise the
    // first call (e.g. an iOS spec) replaces the ResolverResult with its converted
    // output, and later calls (e.g. the default web spec) skip conversion and reuse
    // it. Rebuild fresh response/content objects so each call converts from scratch.
    const resolvedResponses: Record<string, unknown> = {}

    for (const key of Object.keys(tmp.responses)) {
      const response = tmp.responses[key]

      if (!response || !("content" in response) || !response.content) {
        resolvedResponses[key] = response
        continue
      }

      const resolvedContent: Record<string, unknown> = {}

      for (const contentKey of Object.keys(response.content)) {
        const raw = response.content[contentKey]

        if (!raw) continue

        if (raw.schema && "builder" in raw.schema) {
          const result = await raw.schema.builder(config)
          resolvedContent[contentKey] = { ...raw, schema: result.schema }
          if (result.components) {
            components = {
              ...components,
              ...result.components,
            }
          }
        } else {
          resolvedContent[contentKey] = raw
        }
      }

      resolvedResponses[key] = { ...response, content: resolvedContent }
    }

    tmp.responses = resolvedResponses as typeof tmp.responses
  }

  return { docs: tmp, components }
}
