export class ApiError extends Error {
  constructor(
    public status: number,
    public errorCode: string,
    message: string,
    public detail?: unknown
  ) {
    super(message);
  }
}

export const Errors = {
  notFound: (entity: string, id: string) =>
    new ApiError(404, 'NOT_FOUND', `${entity} ${id} was not found`),
  forbidden: (action?: string) =>
    new ApiError(403, 'FORBIDDEN', `You do not have permission${action ? ` to ${action}` : ' for this action'}`),
  unauthorized: () => new ApiError(401, 'UNAUTHORIZED', 'Authentication is required'),
  badRequest: (message: string, detail?: unknown) =>
    new ApiError(400, 'BAD_REQUEST', message, detail),
  conflict: (message: string) => new ApiError(409, 'CONFLICT', message),
  validation: (message: string, detail?: unknown) =>
    new ApiError(422, 'VALIDATION_FAILED', message, detail),
};
