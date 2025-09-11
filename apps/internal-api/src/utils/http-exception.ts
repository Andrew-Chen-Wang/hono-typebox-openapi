import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { ErrorCode } from "./errors.enum"
import { createErrorObject } from "./errors/error.serializer"
import type { ErrorDetail } from "./errors/error.types"

type HTTPStatusCode = 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429 | 500 | 503

export function throwHTTPException(
  status: HTTPStatusCode,
  code: ErrorCode,
  message: string,
  options?: {
    target?: string
    details?: ErrorDetail[]
    innererror?: {
      code: string
      innererror?: ErrorDetail["innererror"]
      // biome-ignore lint/suspicious/noExplicitAny: anything other than any might not work here
      [key: string]: any
    }
  },
): never {
  throw new HTTPException(status, {
    message: createErrorObject(code, message, options),
  })
}

/**
 * Returns a standardized error response format
 *
 * @param c Hono context
 * @param status HTTP status code
 * @param code Error code from ErrorCode enum
 * @param message Human-readable error message
 * @param options Additional error options (target, details, innererror)
 */
export function throwError(
  c: Context,
  status: HTTPStatusCode,
  code: ErrorCode,
  message: string,
  options?: {
    target?: string
    details?: ErrorDetail[]
    innererror?: {
      code: string
      innererror?: ErrorDetail["innererror"]
      // biome-ignore lint/suspicious/noExplicitAny: anything other than any might not work here
      [key: string]: any
    }
  },
) {
  return c.json(createErrorObject(code, message, options), { status })
}

// Common error throwing helpers

export function throwBadRequest(
  c: Context,
  message = "Bad request",
  code: ErrorCode = ErrorCode.BadRequest,
  options?: Parameters<typeof throwError>[4],
) {
  return throwError(c, 400, code, message, options)
}

export function throwUnauthenticated(
  c: Context,
  message = "Bad request",
  code: ErrorCode = ErrorCode.Unauthenticated,
  options?: Parameters<typeof throwError>[4],
) {
  return throwError(c, 401, code, message, options)
}

export function throwForbidden(
  c: Context,
  message = "Forbidden",
  code: ErrorCode = ErrorCode.Forbidden,
  options?: Parameters<typeof throwError>[4],
) {
  return throwError(c, 403, code, message, options)
}

export function throwNotFound(
  c: Context,
  message = "Not found",
  code: ErrorCode = ErrorCode.NotFound,
  options?: Parameters<typeof throwError>[4],
) {
  return throwError(c, 404, code, message, options)
}

export function throwTooManyRequests(
  c: Context,
  message = "Too many requests",
  code: ErrorCode = ErrorCode.TooManyRequests,
  options?: Parameters<typeof throwError>[4],
) {
  return throwError(c, 429, code, message, options)
}

export function throwInternalServerError(
  c: Context,
  message = "Internal server error",
  code: ErrorCode = ErrorCode.InternalServerError,
  options?: Parameters<typeof throwError>[4],
) {
  return throwError(c, 500, code, message, options)
}
