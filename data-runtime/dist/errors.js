export class HttpError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'HttpError';
    }
}
export function httpError(status, code, message) {
    return new HttpError(status, code, message);
}
export function errorResponse(error) {
    if (error instanceof HttpError) {
        return {
            status: error.status,
            body: {
                error: {
                    code: error.code,
                    message: error.message
                }
            }
        };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
        status: 500,
        body: {
            error: {
                code: 'internal_error',
                message
            }
        }
    };
}
