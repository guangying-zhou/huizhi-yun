export function unauthorizedStatus(error: unknown): number
export function isRecoverableRequest(request: unknown, origin: string): boolean
export function canReplay(options?: { method?: string, body?: unknown, headers?: unknown } | null): boolean
export function coalesce<T>(task: () => T | Promise<T>): () => Promise<T>
export function withUnauthorizedRecovery<F extends (...args: never[]) => unknown>(
  baseFetch: F,
  options: { origin: () => string, recover: () => Promise<boolean>, getScope: () => string }
): F
