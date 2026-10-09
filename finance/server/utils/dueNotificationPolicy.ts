export type FinanceDueStream = 'invoice_issuance_due' | 'receipt_reconciliation_due'
export type FinanceDuePhase = 'D30' | 'D7' | 'D1' | 'expired'
export type FinanceDueSourceType = 'invoice_request' | 'finance_receipt'

export interface FinanceDueCandidate {
  stream: FinanceDueStream
  phase: FinanceDuePhase
  sourceType: FinanceDueSourceType
  sourceId: number
  sourceCode: string
  sourceName: string
  dueAt: string
  recipientCandidates: string[]
  eventVersion: string
  previousEventVersion?: string | null
  previousRecipientUid?: string | null
  idempotencyKey: string
  actionableKey: string
}

export interface FinanceDueClosure {
  checkpointEventVersion: string
  expectedVersion: string
  actionableKey: string
  sourceType: FinanceDueSourceType
  sourceId: number
  sourceCode: string
  recipientUid: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
}

export interface DirectoryUser { uid?: string, status?: number | string }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const keys = Object.keys(value)
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key))
}

function stableText(value: unknown, maxLength = 256) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maxLength) return ''
  return [...normalized].some(character => (character.codePointAt(0) || 0) < 32 || character.codePointAt(0) === 127) ? '' : normalized
}

function explicitUid(value: unknown) {
  const uid = stableText(value, 128)
  return uid && uid.toLowerCase() !== '@all' ? uid : ''
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function rfc3339(value: unknown) {
  const normalized = stableText(value, 64)
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : ''
}

function fail(part: string): never {
  throw new Error(`Invalid Finance due notification runtime contract: ${part}`)
}

export function sourceTypeForFinanceDueStream(stream: FinanceDueStream): FinanceDueSourceType {
  return stream === 'invoice_issuance_due' ? 'invoice_request' : 'finance_receipt'
}

export function requireFinanceDueCandidate(value: unknown, expectedStream: FinanceDueStream): FinanceDueCandidate {
  const candidate = record(value)
  const required = ['stream', 'phase', 'sourceType', 'sourceId', 'sourceCode', 'sourceName', 'dueAt', 'recipientCandidates', 'eventVersion', 'idempotencyKey', 'actionableKey']
  if (!candidate || !exactKeys(candidate, required, ['previousEventVersion', 'previousRecipientUid'])) fail('candidate shape')
  const sourceId = positiveInteger(candidate.sourceId)
  const sourceCode = stableText(candidate.sourceCode, 100)
  const sourceName = stableText(candidate.sourceName, 256)
  const dueAt = rfc3339(candidate.dueAt)
  const eventVersion = stableText(candidate.eventVersion)
  const idempotencyKey = stableText(candidate.idempotencyKey, 191)
  const actionableKey = stableText(candidate.actionableKey, 191)
  const previousEventVersion = candidate.previousEventVersion == null ? null : stableText(candidate.previousEventVersion)
  const previousRecipientUid = candidate.previousRecipientUid == null ? null : explicitUid(candidate.previousRecipientUid)
  const recipients = candidate.recipientCandidates
  if (candidate.stream !== expectedStream || candidate.sourceType !== sourceTypeForFinanceDueStream(expectedStream)
    || !['D30', 'D7', 'D1', 'expired'].includes(String(candidate.phase)) || !sourceId || !sourceCode || !sourceName || !dueAt
    || !eventVersion || !idempotencyKey || !actionableKey || !Array.isArray(recipients) || recipients.length !== 1
    || explicitUid(recipients[0]) !== recipients[0]
    || (candidate.previousEventVersion != null && !previousEventVersion)
    || (candidate.previousRecipientUid != null && !previousRecipientUid)) fail('candidate values')
  return {
    stream: expectedStream,
    phase: candidate.phase as FinanceDuePhase,
    sourceType: sourceTypeForFinanceDueStream(expectedStream),
    sourceId,
    sourceCode,
    sourceName,
    dueAt,
    recipientCandidates: [recipients[0]],
    eventVersion,
    ...(candidate.previousEventVersion !== undefined ? { previousEventVersion } : {}),
    ...(candidate.previousRecipientUid !== undefined ? { previousRecipientUid } : {}),
    idempotencyKey,
    actionableKey
  }
}

export function requireFinanceDueClosure(value: unknown, expectedStream: FinanceDueStream): FinanceDueClosure {
  const closure = record(value)
  const required = ['checkpointEventVersion', 'expectedVersion', 'actionableKey', 'sourceType', 'sourceId', 'sourceCode', 'recipientUid', 'nextVersion', 'state']
  if (!closure || !exactKeys(closure, required)) fail('closure shape')
  const result = {
    checkpointEventVersion: stableText(closure.checkpointEventVersion),
    expectedVersion: stableText(closure.expectedVersion),
    actionableKey: stableText(closure.actionableKey, 191),
    sourceType: sourceTypeForFinanceDueStream(expectedStream),
    sourceId: positiveInteger(closure.sourceId),
    sourceCode: stableText(closure.sourceCode, 100),
    recipientUid: explicitUid(closure.recipientUid),
    nextVersion: stableText(closure.nextVersion),
    state: closure.state as FinanceDueClosure['state']
  }
  if (closure.sourceType !== result.sourceType || !result.checkpointEventVersion || !result.expectedVersion || !result.actionableKey
    || !result.sourceId || !result.sourceCode || !result.recipientUid || !result.nextVersion || !['resolved', 'cancelled'].includes(String(closure.state))) fail('closure values')
  return result
}

export function requireFinanceDueRuntimePage(value: unknown, stream: FinanceDueStream, asOf: string) {
  const page = record(value)
  if (!page || !exactKeys(page, ['stream', 'asOf', 'items', 'closures', 'nextCursor']) || page.stream !== stream || page.asOf !== asOf
    || !Array.isArray(page.items) || !Array.isArray(page.closures)) fail('page shape')
  const nextCursor = page.nextCursor === null ? null : stableText(page.nextCursor, 2048)
  if (page.nextCursor !== null && !nextCursor) fail('page cursor')
  return {
    stream,
    asOf,
    items: page.items.map(item => requireFinanceDueCandidate(item, stream)),
    closures: page.closures.map(item => requireFinanceDueClosure(item, stream)),
    nextCursor
  }
}

export function financeDueNotificationsEnabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export async function resolveFinanceDueRecipient(candidate: FinanceDueCandidate, findActiveUser: (uid: string) => Promise<DirectoryUser | null>) {
  const uid = explicitUid(candidate.recipientCandidates[0])
  if (!uid) return null
  const user = await findActiveUser(uid)
  return explicitUid(user?.uid) === uid && (user?.status === 1 || user?.status === 'active') ? uid : null
}

export function financeDueEventType(stream: FinanceDueStream) {
  return stream === 'invoice_issuance_due' ? 'finance.invoice_request.issuance_due' : 'finance.receipt.reconciliation_due'
}

export function financeDueAuthorizationDescriptor(candidate: FinanceDueCandidate) {
  return { resource: candidate.sourceType, id: candidate.sourceCode }
}

export function financeDueMessage(candidate: FinanceDueCandidate) {
  const invoice = candidate.stream === 'invoice_issuance_due'
  return {
    title: `${invoice ? '开票处理' : '到账核销'} ${candidate.phase}：${candidate.sourceCode}`,
    description: `${candidate.sourceName}；截止时间 ${candidate.dueAt}`,
    url: invoice
      ? `/finance/invoices/requests/${encodeURIComponent(candidate.sourceCode)}`
      : `/finance/receipts/${encodeURIComponent(candidate.sourceCode)}`,
    buttonText: invoice ? '查看开票申请' : '查看到账记录'
  }
}
