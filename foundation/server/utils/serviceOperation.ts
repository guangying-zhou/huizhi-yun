export type ServiceOperationFailureClass
  = | 'authentication'
    | 'authorization'
    | 'contract'
    | 'conflict'
    | 'transient'

export type ServiceOperationConflictDisposition
  = | 'idempotent_success'
    | 'processing'
    | 'payload_mismatch'
    | 'binding_conflict'
    | 'permanent'

export interface ServiceOperationFailureOptions {
  conflictDisposition?: ServiceOperationConflictDisposition
  maxSummaryLength?: number
}

export interface ServiceOperationFailure {
  statusCode?: number
  code: string
  classification: ServiceOperationFailureClass
  retryable: boolean
  idempotentSuccess: boolean
  conflictDisposition?: ServiceOperationConflictDisposition
  timedOut: boolean
  networkError: boolean
  summary: string
}

export interface ClaimedServiceCommand {
  operationId: unknown
  targetApp: unknown
  operationCode: unknown
  requiredCapability: unknown
  idempotencyKey: unknown
  commandSchemaVersion: unknown
  commandSha256: unknown
  correlationKey?: unknown
  command: unknown
}

export interface ServiceCommandReceipt {
  receiptId: string
  receiptStatus: 'succeeded'
  operationId: string
  operationCode: string
  idempotencyKey: string
  commandSchemaVersion: string
  commandSha256: string
  targetBizType: string
  targetBizCode: string
  responseSummarySha256: string
  idempotent: boolean
}

const DEFAULT_SUMMARY_LENGTH = 1000
const MAX_ERROR_CHAIN_DEPTH = 8
const STABLE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,119}$/
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const JWT_TEST_PATTERN = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/
const URL_PATTERN = /\b(?:https?|wss?|ftp):\/\/[^\s<>"']+/giu
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/-]+={0,2}/giu
const SENSITIVE_HEADER_PATTERN = /\b(?:authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/giu
const SENSITIVE_VALUE_PATTERN = /\b(?:authorization|password|passwd|secret|client[_-]?secret|cookie|set[_-]?cookie|credential|private[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?token|id[_-]?token|token|api[_-]?key)\b\s*(?:[:=]\s*|\s+)[^\s,;]+/giu
const PROVIDER_SECRET_PATTERN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/giu
const NETWORK_CODES = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
])
const IDEMPOTENT_SUCCESS_CONFLICT_CODES = new Set([
  'delivery_already_synced',
  'integration_operation_already_succeeded',
  'operation_already_succeeded',
  'request_already_succeeded'
])
const PROCESSING_CONFLICT_CODES = new Set([
  'integration_operation_in_progress',
  'operation_in_progress',
  'request_in_progress',
  'runtime_update_in_progress'
])
const PAYLOAD_MISMATCH_CONFLICT_CODES = new Set([
  'idempotency_key_conflict',
  'idempotency_payload_mismatch',
  'integration_operation_command_invalid',
  'operation_payload_mismatch',
  'payload_mismatch'
])

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function serviceCommandReceiptMismatch() {
  return Object.assign(new Error('Target service command receipt does not match the claimed operation.'), {
    statusCode: 422,
    code: 'service_command_receipt_mismatch'
  })
}

export function buildServiceCommandEnvelope(operation: ClaimedServiceCommand) {
  const operationId = stringValue(operation.operationId)
  const targetApp = safeStableCode(operation.targetApp)
  const operationCode = safeStableCode(operation.operationCode)
  const requiredCapability = safeStableCode(operation.requiredCapability)
  const idempotencyKey = safeStableCode(operation.idempotencyKey)
  const commandSchemaVersion = safeStableCode(operation.commandSchemaVersion)
  const commandSha256 = stringValue(operation.commandSha256)
  const command = recordValue(operation.command)
  if (
    !operationId
    || !targetApp
    || !operationCode
    || !requiredCapability
    || !idempotencyKey
    || !commandSchemaVersion
    || !SHA256_PATTERN.test(commandSha256)
    || !command
  ) {
    throw new Error('Claimed service command receipt metadata is invalid.')
  }
  return {
    serviceCommand: {
      operationId,
      targetApp,
      operationCode,
      requiredCapability,
      idempotencyKey,
      commandSchemaVersion,
      commandSha256,
      correlationId: safeStableCode(operation.correlationKey),
      command
    }
  }
}

export function validateServiceCommandReceipt(
  operation: ClaimedServiceCommand,
  value: unknown,
  expected: { targetBizType: string, targetBizCode: string }
): ServiceCommandReceipt {
  const receipt = recordValue(value)
  const expectedEnvelope = buildServiceCommandEnvelope(operation).serviceCommand
  const normalized: ServiceCommandReceipt = {
    receiptId: stringValue(receipt?.receiptId),
    receiptStatus: stringValue(receipt?.receiptStatus) as 'succeeded',
    operationId: stringValue(receipt?.operationId),
    operationCode: stringValue(receipt?.operationCode),
    idempotencyKey: stringValue(receipt?.idempotencyKey),
    commandSchemaVersion: stringValue(receipt?.commandSchemaVersion),
    commandSha256: stringValue(receipt?.commandSha256),
    targetBizType: stringValue(receipt?.targetBizType),
    targetBizCode: stringValue(receipt?.targetBizCode),
    responseSummarySha256: stringValue(receipt?.responseSummarySha256),
    idempotent: receipt?.idempotent === true
  }
  if (
    !UUID_V4_PATTERN.test(normalized.receiptId)
    || normalized.receiptStatus !== 'succeeded'
    || normalized.operationId !== expectedEnvelope.operationId
    || normalized.operationCode !== expectedEnvelope.operationCode
    || normalized.idempotencyKey !== expectedEnvelope.idempotencyKey
    || normalized.commandSchemaVersion !== expectedEnvelope.commandSchemaVersion
    || normalized.commandSha256 !== expectedEnvelope.commandSha256
    || normalized.targetBizType !== expected.targetBizType
    || normalized.targetBizCode !== expected.targetBizCode
    || !SHA256_PATTERN.test(normalized.responseSummarySha256)
  ) {
    throw serviceCommandReceiptMismatch()
  }
  return normalized
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as Record<string, unknown>
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function errorChain(error: unknown) {
  const chain: unknown[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && chain.length < MAX_ERROR_CHAIN_DEPTH && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = recordValue(current)?.cause
  }
  return chain
}

function payloadRecords(error: Record<string, unknown>) {
  const response = recordValue(error.response)
  return [
    recordValue(error.data),
    recordValue(response?._data),
    recordValue(response?.data),
    recordValue(error.body)
  ].filter((value): value is Record<string, unknown> => Boolean(value))
}

function validHttpStatus(value: unknown) {
  const status = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(status) || status < 100 || status > 599) return undefined
  return status
}

function nestedUpstreamStatus(error: Record<string, unknown>) {
  const candidates: unknown[] = [error.upstreamStatus, error.upstream_status]
  for (const payload of payloadRecords(error)) {
    const envelope = recordValue(payload.error)
    candidates.push(payload.upstreamStatus, payload.upstream_status, envelope?.upstreamStatus, envelope?.upstream_status)
  }
  for (const candidate of candidates) {
    const status = validHttpStatus(candidate)
    if (status !== undefined) return status
  }
  return undefined
}

function directHttpStatus(error: Record<string, unknown>) {
  const response = recordValue(error.response)
  const candidates: unknown[] = [error.statusCode, error.status, response?.statusCode, response?.status]
  for (const payload of payloadRecords(error)) {
    const envelope = recordValue(payload.error)
    candidates.push(payload.statusCode, payload.status, envelope?.statusCode, envelope?.status)
  }
  for (const candidate of candidates) {
    const status = validHttpStatus(candidate)
    if (status !== undefined) return status
  }
  return undefined
}

export function extractServiceOperationStatus(error: unknown): number | undefined {
  const chain = errorChain(error)
  for (const item of chain) {
    const record = recordValue(item)
    if (!record) continue
    const upstreamStatus = nestedUpstreamStatus(record)
    if (upstreamStatus !== undefined) return upstreamStatus
  }
  for (const item of chain) {
    const record = recordValue(item)
    if (!record) continue
    const status = directHttpStatus(record)
    if (status !== undefined) return status
  }
  return undefined
}

function safeStableCode(value: unknown) {
  const code = stringValue(value)
  if (!STABLE_CODE_PATTERN.test(code) || JWT_TEST_PATTERN.test(code) || /^(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}$/i.test(code)) {
    return ''
  }
  return code
}

export function extractServiceOperationCode(error: unknown, statusCode = extractServiceOperationStatus(error)) {
  for (const item of errorChain(error)) {
    const record = recordValue(item)
    if (!record) continue
    for (const payload of payloadRecords(record)) {
      const envelope = recordValue(payload.error)
      for (const candidate of [envelope?.code, payload.code, payload.errorCode, payload.error_code]) {
        const code = safeStableCode(candidate)
        if (code) return code
      }
    }
    for (const candidate of [record.code, record.errorCode, record.error_code]) {
      const code = safeStableCode(candidate)
      if (code) return code
    }
  }
  return statusCode ? `http_${statusCode}` : 'service_operation_failed'
}

/**
 * Resolves HTTP 409 semantics from a stable machine-readable error code.
 * Unknown conflicts stay permanent: message text is intentionally ignored so
 * localization or provider wording cannot accidentally turn a conflict into a retry.
 */
export function resolveServiceOperationConflictDisposition(error: unknown): ServiceOperationConflictDisposition {
  const code = extractServiceOperationCode(error).toLowerCase()
  if (IDEMPOTENT_SUCCESS_CONFLICT_CODES.has(code)) return 'idempotent_success'
  if (PROCESSING_CONFLICT_CODES.has(code) || code.endsWith('_in_progress')) return 'processing'
  if (PAYLOAD_MISMATCH_CONFLICT_CODES.has(code)) return 'payload_mismatch'
  if (
    code.endsWith('_binding_conflict')
    || code.endsWith('_context_mismatch')
    || code.endsWith('_environment_mismatch')
    || code === 'ops_knowledge_reservation_mismatch'
  ) {
    return 'binding_conflict'
  }
  return 'permanent'
}

function errorMessage(error: unknown) {
  for (const item of errorChain(error)) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    const record = recordValue(item)
    if (!record) continue
    for (const payload of payloadRecords(record)) {
      const envelope = recordValue(payload.error)
      for (const candidate of [envelope?.message, payload.message, payload.statusMessage, payload.status_message]) {
        const message = stringValue(candidate)
        if (message) return message
      }
    }
    for (const candidate of [record.statusMessage, record.status_message, record.message]) {
      const message = stringValue(candidate)
      if (message) return message
    }
  }
  return ''
}

export function sanitizeServiceOperationErrorSummary(value: unknown, maxLength = DEFAULT_SUMMARY_LENGTH) {
  const boundedLength = Number.isFinite(maxLength) && maxLength > 0
    ? Math.floor(maxLength)
    : DEFAULT_SUMMARY_LENGTH
  let summary = String(value ?? '')
  summary = summary.replace(URL_PATTERN, '[redacted-url]')
  summary = summary.replace(SENSITIVE_HEADER_PATTERN, '[redacted-secret]')
  summary = summary.replace(BEARER_PATTERN, '[redacted-secret]')
  summary = summary.replace(JWT_PATTERN, '[redacted-secret]')
  summary = summary.replace(SENSITIVE_VALUE_PATTERN, '[redacted-secret]')
  summary = summary.replace(PROVIDER_SECRET_PATTERN, '[redacted-secret]')
  summary = summary.replace(/\p{Cc}/gu, ' ')
  summary = summary.replace(/\s+/gu, ' ').trim()
  return [...summary].slice(0, boundedLength).join('')
}

function errorSignals(error: unknown) {
  let timedOut = false
  let networkError = false
  for (const item of errorChain(error)) {
    const record = recordValue(item)
    const name = stringValue(record?.name).toLowerCase()
    const code = stringValue(record?.code).toUpperCase()
    const message = typeof item === 'string' ? item : stringValue(record?.message)
    if (name === 'timeouterror' || name === 'aborterror' || code.includes('TIMEOUT') || /\b(?:timed?\s*out|timeout)\b/i.test(message)) {
      timedOut = true
    }
    if (
      NETWORK_CODES.has(code)
      || (name === 'fetcherror' && extractServiceOperationStatus(item) === undefined)
      || /\b(?:fetch failed|network error|socket hang up|connection (?:reset|refused)|dns lookup|host unreachable)\b/i.test(message)
    ) {
      networkError = true
    }
  }
  return { timedOut, networkError }
}

export function classifyServiceOperationFailure(
  error: unknown,
  options: ServiceOperationFailureOptions = {}
): ServiceOperationFailure {
  const statusCode = extractServiceOperationStatus(error)
  const { timedOut, networkError } = errorSignals(error)
  let classification: ServiceOperationFailureClass
  let retryable = false
  let idempotentSuccess = false

  if (statusCode === 401) {
    classification = 'authentication'
  } else if (statusCode === 403) {
    classification = 'authorization'
  } else if (statusCode === 409) {
    if (!options.conflictDisposition) {
      throw new TypeError('conflictDisposition is required for HTTP 409')
    }
    if (options.conflictDisposition === 'processing') {
      classification = 'transient'
      retryable = true
    } else {
      classification = 'conflict'
      idempotentSuccess = options.conflictDisposition === 'idempotent_success'
    }
  } else if (
    statusCode === undefined
    || timedOut
    || networkError
    || statusCode === 408
    || statusCode === 425
    || statusCode === 429
    || statusCode >= 500
  ) {
    classification = 'transient'
    retryable = true
  } else {
    classification = 'contract'
  }

  const code = extractServiceOperationCode(error, statusCode)
  const summary = sanitizeServiceOperationErrorSummary(
    errorMessage(error) || code,
    options.maxSummaryLength
  ) || code

  return {
    statusCode,
    code,
    classification,
    retryable,
    idempotentSuccess,
    ...(statusCode === 409 ? { conflictDisposition: options.conflictDisposition } : {}),
    timedOut,
    networkError,
    summary
  }
}
