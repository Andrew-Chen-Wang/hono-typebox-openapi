import { HTTPException } from "hono/http-exception"
import { describe, expect, it } from "vitest"
import { ErrorCode } from "../errors.enum"
import { throwHTTPException } from "../http-exception"
import { createErrorObject, createErrorResponse } from "./error.serializer"
import type { ErrorDetail } from "./error.types"

interface ParsedErrorResponse {
  error: ErrorDetail
}

describe("Error utilities", () => {
  describe("createErrorResponse", () => {
    it("should create a basic error response", () => {
      const response = createErrorResponse(ErrorCode.BadRequest, "Invalid input")

      expect(response).toEqual({
        error: {
          code: ErrorCode.BadRequest,
          message: "Invalid input",
        },
      })
    })

    it("should create an error response with target", () => {
      const response = createErrorResponse(ErrorCode.ValidationFailed, "Validation failed", {
        target: "email",
      })

      expect(response).toEqual({
        error: {
          code: ErrorCode.ValidationFailed,
          message: "Validation failed",
          target: "email",
        },
      })
    })

    it("should create an error response with details", () => {
      const response = createErrorResponse(
        ErrorCode.ValidationFailed,
        "Multiple validation errors",
        {
          details: [
            { code: "required", message: "Field is required", target: "name" },
            { code: "format", message: "Invalid email format", target: "email" },
          ],
        },
      )

      expect(response.error.code).toBe(ErrorCode.ValidationFailed)
      expect(response.error.message).toBe("Multiple validation errors")
      expect(response.error.details).toHaveLength(2)
      expect(response.error.details?.[0].target).toBe("name")
      expect(response.error.details?.[1].code).toBe("format")
    })

    it("should create an error response with nested details", () => {
      const response = createErrorResponse(
        ErrorCode.ValidationFailed,
        "Multiple validation errors",
        {
          details: [
            {
              code: "object_validation",
              message: "Object validation failed",
              target: "user",
              details: [
                { code: "required", message: "Field is required", target: "name" },
                { code: "format", message: "Invalid email format", target: "email" },
              ],
            },
          ],
        },
      )

      expect(response.error.code).toBe(ErrorCode.ValidationFailed)
      expect(response.error.details).toHaveLength(1)

      const firstDetail = response.error.details?.[0]
      expect(firstDetail?.code).toBe("object_validation")
      expect(firstDetail?.details).toHaveLength(2)
      expect(firstDetail?.details?.[0].target).toBe("name")
      expect(firstDetail?.details?.[1].code).toBe("format")
    })

    it("should create an error response with innererror", () => {
      const response = createErrorResponse(ErrorCode.InternalServerError, "Database error", {
        innererror: {
          code: "DB_CONNECTION_FAILED",
          details: "Connection timeout after 30s",
        },
      })

      expect(response.error.code).toBe(ErrorCode.InternalServerError)
      expect(response.error.innererror?.code).toBe("DB_CONNECTION_FAILED")
      expect(response.error.innererror?.details).toBe("Connection timeout after 30s")
    })
  })

  describe("createErrorObject", () => {
    it("should create a JSON string of the error response", () => {
      const errorObj = createErrorObject(ErrorCode.NotFound, "Resource not found")
      const parsed = JSON.parse(errorObj) as ParsedErrorResponse

      expect(parsed).toEqual({
        error: {
          code: ErrorCode.NotFound,
          message: "Resource not found",
        },
      })
    })
  })

  describe("throwHTTPException helpers", () => {
    it("throwBadRequest should throw HTTPException with status 400", () => {
      try {
        throwHTTPException(400, ErrorCode.BadRequest, "Invalid input")
        expect.fail("Should have thrown an exception")
      } catch (error) {
        if (!(error instanceof HTTPException)) {
          throw new Error("Expected HTTPException")
        }
        expect(error.status).toBe(400)
        const message = JSON.parse(error.message) as ParsedErrorResponse
        expect(message.error.code).toBe(ErrorCode.BadRequest)
        expect(message.error.message).toBe("Invalid input")
      }
    })

    it("throwForbidden should allow custom error code", () => {
      try {
        throwHTTPException(403, ErrorCode.InsufficientPermissions, "Insufficient permissions")
        expect.fail("Should have thrown an exception")
      } catch (error) {
        if (!(error instanceof HTTPException)) {
          throw new Error("Expected HTTPException")
        }
        expect(error.status).toBe(403)
        const message = JSON.parse(error.message) as ParsedErrorResponse
        expect(message.error.code).toBe(ErrorCode.InsufficientPermissions)
        expect(message.error.message).toBe("Insufficient permissions")
      }
    })

    it("throwNotFound should allow details", () => {
      try {
        throwHTTPException(404, ErrorCode.ResourceNotFound, "User not found", {
          target: "user",
          details: [{ code: "not_found", message: "User with ID 123 not found" }],
        })
        expect.fail("Should have thrown an exception")
      } catch (error) {
        if (!(error instanceof HTTPException)) {
          throw new Error("Expected HTTPException")
        }
        expect(error.status).toBe(404)
        const message = JSON.parse(error.message) as ParsedErrorResponse
        expect(message.error.code).toBe(ErrorCode.ResourceNotFound)
        expect(message.error.target).toBe("user")
        expect(message.error.details).toHaveLength(1)
        expect(message.error.details?.[0].message).toContain("User with ID 123")
      }
    })
  })
})
