export type ReceivableDuePhase = 'D30' | 'D7' | 'D1' | 'expired'

export interface ReceivableDueCandidate {
  stream: 'receivable_plan_due'
  phase: ReceivableDuePhase
  sourceType: 'receivable_plan'
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

export interface ReceivableDueClosure {
  checkpointEventVersion: string
  expectedVersion: string
  actionableKey: string
  sourceType: 'receivable_plan'
  sourceId: number
  sourceCode: string
  recipientUid: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
}

export interface DirectoryUser { uid?: string, status?: number | string }
function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function stable(value: unknown, max = 256) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result && result.length <= max && ![...result].some(character => (character.codePointAt(0) || 0) < 32 || character.codePointAt(0) === 127) ? result : ''
}
function uid(value: unknown) {
  const result = stable(value, 128)
  return result && result.toLowerCase() !== '@all' ? result : ''
}
function id(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return required.every(key => key in value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}
function fail(part: string): never {
  throw new Error(`Invalid Altoc receivable due runtime contract: ${part}`)
}

export function requireReceivableDueCandidate(value: unknown): ReceivableDueCandidate {
  const item = record(value)
  const required = ['stream', 'phase', 'sourceType', 'sourceId', 'sourceCode', 'sourceName', 'dueAt', 'recipientCandidates', 'eventVersion', 'idempotencyKey', 'actionableKey']
  if (!item || !exact(item, required, ['previousEventVersion', 'previousRecipientUid'])) fail('candidate shape')
  const sourceId = id(item.sourceId)
  const sourceCode = stable(item.sourceCode, 30)
  const sourceName = stable(item.sourceName)
  const dueAt = stable(item.dueAt, 64)
  const recipient = Array.isArray(item.recipientCandidates) ? uid(item.recipientCandidates[0]) : ''
  const eventVersion = stable(item.eventVersion)
  const idempotencyKey = stable(item.idempotencyKey, 191)
  const actionableKey = stable(item.actionableKey, 191)
  const previousEventVersion = item.previousEventVersion == null ? null : stable(item.previousEventVersion)
  const previousRecipientUid = item.previousRecipientUid == null ? null : uid(item.previousRecipientUid)
  const recipients = item.recipientCandidates
  if (item.stream !== 'receivable_plan_due' || item.sourceType !== 'receivable_plan' || !['D30', 'D7', 'D1', 'expired'].includes(String(item.phase))
    || !sourceId || !sourceCode || !sourceName || !dueAt || Number.isNaN(Date.parse(dueAt))
    || !Array.isArray(recipients) || recipients.length !== 1 || recipient !== recipients[0]
    || !eventVersion || !idempotencyKey || !actionableKey
    || (item.previousEventVersion != null && !previousEventVersion)
    || (item.previousRecipientUid != null && !previousRecipientUid)) fail('candidate values')
  return {
    stream: 'receivable_plan_due',
    phase: item.phase as ReceivableDuePhase,
    sourceType: 'receivable_plan',
    sourceId,
    sourceCode,
    sourceName,
    dueAt,
    recipientCandidates: [recipient],
    eventVersion,
    ...(item.previousEventVersion !== undefined ? { previousEventVersion } : {}),
    ...(item.previousRecipientUid !== undefined ? { previousRecipientUid } : {}),
    idempotencyKey,
    actionableKey
  }
}

export function requireReceivableDueClosure(value: unknown): ReceivableDueClosure {
  const item = record(value)
  const keys = ['checkpointEventVersion', 'expectedVersion', 'actionableKey', 'sourceType', 'sourceId', 'sourceCode', 'recipientUid', 'nextVersion', 'state']
  if (!item || !exact(item, keys)) fail('closure shape')
  const result = {
    checkpointEventVersion: stable(item.checkpointEventVersion),
    expectedVersion: stable(item.expectedVersion),
    actionableKey: stable(item.actionableKey, 191),
    sourceType: 'receivable_plan' as const,
    sourceId: id(item.sourceId),
    sourceCode: stable(item.sourceCode, 30),
    recipientUid: uid(item.recipientUid),
    nextVersion: stable(item.nextVersion),
    state: item.state as ReceivableDueClosure['state']
  }
  if (item.sourceType !== 'receivable_plan' || !result.sourceId || !result.sourceCode || !result.recipientUid
    || !result.checkpointEventVersion || !result.expectedVersion || !result.actionableKey || !result.nextVersion
    || !['resolved', 'cancelled'].includes(String(item.state))) fail('closure values')
  return result
}

export function requireReceivableDueRuntimePage(value: unknown, asOf: string) {
  const page = record(value)
  if (!page || !exact(page, ['stream', 'asOf', 'items', 'closures', 'nextCursor']) || page.stream !== 'receivable_plan_due' || page.asOf !== asOf
    || !Array.isArray(page.items) || !Array.isArray(page.closures)) fail('page')
  const nextCursor = page.nextCursor === null ? null : stable(page.nextCursor, 2048)
  if (page.nextCursor !== null && !nextCursor) fail('cursor')
  return { stream: 'receivable_plan_due' as const, asOf, items: page.items.map(requireReceivableDueCandidate), closures: page.closures.map(requireReceivableDueClosure), nextCursor }
}

export function receivableDueNotificationsEnabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}
export async function resolveReceivableDueRecipient(candidate: ReceivableDueCandidate, find: (uid: string) => Promise<DirectoryUser | null>) {
  const direct = uid(candidate.recipientCandidates[0])
  if (!direct) return null
  const user = await find(direct)
  return uid(user?.uid) === direct && (user?.status === 1 || user?.status === 'active') ? direct : null
}
export function receivableDueDescriptor(candidate: ReceivableDueCandidate) {
  return { resource: 'receivable_plan' as const, id: candidate.sourceCode }
}
export function receivableDueMessage(candidate: ReceivableDueCandidate) {
  return {
    title: `应收计划 ${candidate.phase}：${candidate.sourceCode}`,
    description: `${candidate.sourceName}；计划回款日 ${candidate.dueAt}`,
    url: `/altoc/payments/${encodeURIComponent(candidate.sourceCode)}`,
    buttonText: '查看应收计划'
  }
}
