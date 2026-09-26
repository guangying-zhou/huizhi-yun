import { randomUUID } from 'node:crypto'
import { getHeader, type H3Event } from 'h3'

type DiagnosticEvent = H3Event & { context: H3Event['context'] & { authDiagnosticRequestId?: string } }

export function authDiagnosticRequestId(event: H3Event) {
  const context = (event as DiagnosticEvent).context
  if (context.authDiagnosticRequestId) return context.authDiagnosticRequestId
  const supplied = String(getHeader(event, 'x-request-id') || '').trim()
  const requestId = /^[A-Za-z0-9_-]{1,64}$/.test(supplied) ? supplied : randomUUID()
  context.authDiagnosticRequestId = requestId
  return requestId
}

// No URL, response body, error message, cookie, token, UID or policy content.
export function logAuthDependencyFailure(event: H3Event, stage: string, error: unknown, durationMs: number) {
  const failure = error as { dependencyStatus?: unknown, statusCode?: unknown, status?: unknown, response?: { status?: unknown }, name?: unknown,
    cause?: { code?: unknown, cause?: { code?: unknown } } }
  const status = Number(failure?.dependencyStatus || failure?.response?.status || failure?.statusCode || failure?.status || 0)
  const name = String(failure?.name || '')
  const errorClass = ['AbortError', 'TimeoutError', 'FetchError'].includes(name)
    ? name : status >= 400 && status <= 599 ? 'HTTPError' : 'DependencyError'
  const causeCode = String(failure?.cause?.code || failure?.cause?.cause?.code || '')
  const networkCode = ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(causeCode) ? causeCode : undefined
  console.warn(JSON.stringify({ event: 'console-auth-dependency-failure', requestId: authDiagnosticRequestId(event),
    stage, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    errorClass, ...(networkCode ? { networkCode } : {}), durationMs: Math.max(0, Math.round(durationMs)) }))
}
