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
    [key: string]: any
  }
}
