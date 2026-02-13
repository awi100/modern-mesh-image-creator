import { NextResponse } from "next/server";

/**
 * Standard API error response format
 */
interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: string;
}

/**
 * Standard API success response format
 */
interface ApiSuccessResponse<T = unknown> {
  data?: T;
  success?: boolean;
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  message: string,
  status: number,
  options?: {
    code?: string;
    details?: string;
  }
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = {
    error: message,
  };

  if (options?.code) {
    body.code = options.code;
  }

  if (options?.details) {
    body.details = options.details;
  }

  return NextResponse.json(body, { status });
}

/**
 * Common error response helpers
 */
export const ApiError = {
  unauthorized: (message = "Unauthorized") =>
    errorResponse(message, 401, { code: "UNAUTHORIZED" }),

  forbidden: (message = "Forbidden", code?: string) =>
    errorResponse(message, 403, { code: code || "FORBIDDEN" }),

  notFound: (resource = "Resource") =>
    errorResponse(`${resource} not found`, 404, { code: "NOT_FOUND" }),

  badRequest: (message: string, details?: string) =>
    errorResponse(message, 400, { code: "BAD_REQUEST", details }),

  validationError: (message: string, details?: string) =>
    errorResponse(message, 422, { code: "VALIDATION_ERROR", details }),

  serverError: (message: string, error?: unknown) => {
    const details = error instanceof Error ? error.message : undefined;
    return errorResponse(message, 500, { code: "SERVER_ERROR", details });
  },

  limitReached: (message: string) =>
    NextResponse.json(
      { error: message, code: "LIMIT_REACHED", limitReached: true },
      { status: 403 }
    ),
};

/**
 * Create a standardized success response
 */
export function successResponse<T>(
  data: T,
  status = 200
): NextResponse<T | ApiSuccessResponse<T>> {
  return NextResponse.json(data, { status });
}

/**
 * Helper for created resources (201)
 */
export function createdResponse<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

/**
 * Helper for no content (204)
 */
export function noContentResponse(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Helper for delete success
 */
export function deleteSuccess(): NextResponse<{ success: true }> {
  return NextResponse.json({ success: true });
}
