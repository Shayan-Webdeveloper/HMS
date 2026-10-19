export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Authentication required") => new ApiError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to perform this action") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Record not found") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message, details) => new ApiError(409, "CONFLICT", message, details);
export const invalidState = (message) => new ApiError(422, "INVALID_STATE", message);
export const tooMany = (message = "Too many requests. Please wait and try again.") => new ApiError(429, "RATE_LIMITED", message);
