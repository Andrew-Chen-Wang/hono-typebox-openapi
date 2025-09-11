/**
 * Common types for error handling
 */

export type ErrorDetail = {
  code: string
  message: string
  target?: string
  details?: ErrorDetail[]
  innererror?: {
    code: string
    innererror?: ErrorDetail["innererror"]
    // biome-ignore lint/suspicious/noExplicitAny: anything other than any might not work here
    [key: string]: any
  }
}
