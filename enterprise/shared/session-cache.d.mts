export function validatedSessionScope(session: unknown): string
export function isEnterpriseSessionCacheKey(key: unknown): boolean
export function safeLoginRedirect(value: unknown): string
export function createSessionCacheCoordinator(options: { fetchSession: () => Promise<unknown>; onChange: (next: string, previous: string) => void; onVerified?: (next: string) => void }): { refresh: () => Promise<string>; invalidate: () => void; getScope: () => string }
export function watchSessionLoss<T>(fetchSession: () => Promise<T>, onLost: () => void): () => Promise<T>
