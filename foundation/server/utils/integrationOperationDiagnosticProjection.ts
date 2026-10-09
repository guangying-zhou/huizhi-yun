/**
 * Browser boundary for integration-operation diagnostics.
 *
 * tenant-runtime intentionally returns a richer operator DTO so dispatchers can
 * recover work safely.  That DTO is never a browser contract: it contains
 * correlation, idempotency, command-hash and lease evidence which must stay on
 * the server side.  Keep this projection allow-list based so new runtime
 * fields cannot become browser-visible accidentally.
 */
type UnknownRecord = Record<string, unknown>

export interface BrowserIntegrationOperation {
  operationId: string
  targetApp: string
  operationCode: string
  sourceBizType: string
  sourceBizCode: string
  targetBizType?: string
  targetBizCode?: string
  status: string
  attemptCount: number
  maxAttempts: number
  version: number
  lastErrorCode?: string
  lastErrorClass?: string
  nextAttemptAt?: string
  lastAttemptAt?: string
  lastErrorAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface BrowserIntegrationOperationAttempt {
  operationId: string
  operationCode: string
  attemptNo: number
  status: string
  errorCode?: string
  errorClass?: string
  targetBizType?: string
  targetBizCode?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}

function object(value: unknown, name: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`integration operation ${name} is malformed`)
  }
  return value as UnknownRecord
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`integration operation ${name} is malformed`)
  return value
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function requiredNumber(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`integration operation ${name} is malformed`)
  }
  return value
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

export function projectIntegrationOperationList(payload: unknown): { items: BrowserIntegrationOperation[], nextCursor: string | null } {
  const page = object(payload, 'diagnostic page')
  if (!Array.isArray(page.items)) throw new Error('integration operation diagnostic items are malformed')
  if (page.nextCursor !== null && page.nextCursor !== undefined && typeof page.nextCursor !== 'string') {
    throw new Error('integration operation diagnostic cursor is malformed')
  }
  return {
    items: page.items.map((candidate) => {
      const source = object(candidate, 'diagnostic item')
      return compact<BrowserIntegrationOperation>({
        operationId: requiredText(source.operationId, 'operationId'),
        targetApp: requiredText(source.targetApp, 'targetApp'),
        operationCode: requiredText(source.operationCode, 'operationCode'),
        sourceBizType: requiredText(source.sourceBizType, 'sourceBizType'),
        sourceBizCode: requiredText(source.sourceBizCode, 'sourceBizCode'),
        targetBizType: optionalText(source.targetBizType),
        targetBizCode: optionalText(source.targetBizCode),
        status: requiredText(source.status, 'status'),
        attemptCount: requiredNumber(source.attemptCount, 'attemptCount'),
        maxAttempts: requiredNumber(source.maxAttempts, 'maxAttempts'),
        version: requiredNumber(source.version, 'version'),
        lastErrorCode: optionalText(source.lastErrorCode),
        lastErrorClass: optionalText(source.lastErrorClass),
        nextAttemptAt: optionalText(source.nextAttemptAt),
        lastAttemptAt: optionalText(source.lastAttemptAt),
        lastErrorAt: optionalText(source.lastErrorAt),
        createdAt: optionalText(source.createdAt),
        updatedAt: optionalText(source.updatedAt)
      })
    }),
    nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null
  }
}

export function projectIntegrationOperationAttempts(payload: unknown): { operationId: string, items: BrowserIntegrationOperationAttempt[] } {
  const timeline = object(payload, 'attempt timeline')
  const operationId = requiredText(timeline.operationId, 'operationId')
  if (!Array.isArray(timeline.items)) throw new Error('integration operation attempt items are malformed')
  return {
    operationId,
    items: timeline.items.map((candidate) => {
      const source = object(candidate, 'attempt item')
      if (requiredText(source.operationId, 'attempt.operationId') !== operationId) {
        throw new Error('integration operation attempt identity is malformed')
      }
      return compact<BrowserIntegrationOperationAttempt>({
        operationId,
        operationCode: requiredText(source.operationCode, 'attempt.operationCode'),
        attemptNo: requiredNumber(source.attemptNo, 'attemptNo'),
        status: requiredText(source.resultStatus, 'attempt.status'),
        errorCode: optionalText(source.errorCode),
        errorClass: optionalText(source.errorClass),
        targetBizType: optionalText(source.targetBizType),
        targetBizCode: optionalText(source.targetBizCode),
        startedAt: optionalText(source.startedAt),
        finishedAt: optionalText(source.finishedAt),
        durationMs: optionalNumber(source.durationMs)
      })
    })
  }
}

/** The only browser-safe acknowledgement for a controlled replay. */
export function projectIntegrationOperationReplay(operationId: string, expectedVersion: number, reason: string) {
  return { operationId, expectedVersion, reason }
}
