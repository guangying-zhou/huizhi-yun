const DEFAULT_DOCUMENT_OSS_TIMEOUT_MS = 8000
const DOCUMENT_OSS_TIMEOUT_MIN_MS = 1000
const DOCUMENT_OSS_TIMEOUT_MAX_MS = 120000
export const DOCUMENT_OSS_TIMEOUT_ENV = 'HZY_CODOCS_OSS_TIMEOUT_MS'

/**
 * Per-request object-storage timeout for document reads/writes. The default is
 * right for cloud/self-hosted deployments next to the bucket; a development
 * machine far from the region may set the server-side environment variable.
 * Anything outside 1000–120000 ms (or not an integer) falls back to the default
 * and records a fixed code, never the offending value.
 */
export function resolveDocumentOssTimeoutMs(
  raw: unknown = typeof process !== 'undefined' ? process.env?.[DOCUMENT_OSS_TIMEOUT_ENV] : undefined,
  warn: (message: string) => void = message => console.warn(message)
): number {
  const text = String(raw ?? '').trim()
  if (!text) return DEFAULT_DOCUMENT_OSS_TIMEOUT_MS
  const value = /^\d{1,7}$/.test(text) ? Number(text) : Number.NaN
  if (Number.isInteger(value) && value >= DOCUMENT_OSS_TIMEOUT_MIN_MS && value <= DOCUMENT_OSS_TIMEOUT_MAX_MS) return value
  warn(JSON.stringify({ event: 'codocs-oss-timeout-invalid', code: 'codocs_oss_timeout_invalid' }))
  return DEFAULT_DOCUMENT_OSS_TIMEOUT_MS
}
