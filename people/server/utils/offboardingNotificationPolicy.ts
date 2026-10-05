export type PeopleOffboardingStream
  = | 'offboarding_handover_due'
    | 'offboarding_asset_recovery_due'
export type PeopleOffboardingPhase = 'D30' | 'D7' | 'D1' | 'expired'
export type PeopleOffboardingTaskType = 'handover' | 'asset_recovery_coordination'

export interface PeopleOffboardingCandidate {
  stream: PeopleOffboardingStream
  phase: PeopleOffboardingPhase
  sourceType: 'offboarding_task'
  sourceId: number
  sourceCode: string
  sourceName: string
  caseCode: string
  taskCode: string
  taskType: PeopleOffboardingTaskType
  dueAt: string
  recipientCandidates: string[]
  eventVersion: string
  previousEventVersion?: string | null
  previousRecipientUid?: string | null
  idempotencyKey: string
  actionableKey: string
}

export interface PeopleOffboardingClosure {
  checkpointEventVersion: string
  expectedVersion: string
  actionableKey: string
  sourceType: 'offboarding_task'
  sourceId: number
  caseCode: string
  taskCode: string
  taskType: PeopleOffboardingTaskType
  recipientUid: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
}

export interface DirectoryUser {
  uid?: string
  status?: number | string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const keys = Object.keys(value)
  return required.every(key => keys.includes(key))
    && keys.every(key => required.includes(key) || optional.includes(key))
}

function text(value: unknown) {
  return String(value || '').trim()
}

function stableText(value: unknown, maxLength = 256) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maxLength) return ''
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
  return hasControlCharacter ? '' : normalized
}

function optionalStableText(value: unknown, maxLength = 256) {
  if (value === undefined || value === null) return null
  return stableText(value, maxLength) || null
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

function contractError(message: string): never {
  throw new Error(`Invalid People offboarding notification runtime contract: ${message}`)
}

function taskTypeForStream(stream: PeopleOffboardingStream): PeopleOffboardingTaskType {
  return stream === 'offboarding_handover_due' ? 'handover' : 'asset_recovery_coordination'
}

export function requirePeopleOffboardingCandidate(
  value: unknown,
  expectedStream: PeopleOffboardingStream
): PeopleOffboardingCandidate {
  const candidate = record(value)
  const required = [
    'stream', 'phase', 'sourceType', 'sourceId', 'sourceCode', 'sourceName',
    'caseCode', 'taskCode', 'taskType', 'dueAt', 'recipientCandidates',
    'eventVersion', 'idempotencyKey', 'actionableKey'
  ]
  if (!candidate || !exactKeys(candidate, required, ['previousEventVersion', 'previousRecipientUid'])) {
    contractError('candidate shape')
  }
  const sourceId = positiveInteger(candidate.sourceId)
  const sourceCode = stableText(candidate.sourceCode, 64)
  const sourceName = stableText(candidate.sourceName, 256)
  const caseCode = stableText(candidate.caseCode, 64)
  const taskCode = stableText(candidate.taskCode, 64)
  const dueAt = rfc3339(candidate.dueAt)
  const eventVersion = stableText(candidate.eventVersion, 256)
  const idempotencyKey = stableText(candidate.idempotencyKey, 191)
  const actionableKey = stableText(candidate.actionableKey, 191)
  const previousEventVersion = optionalStableText(candidate.previousEventVersion, 256)
  const previousRecipientUid = optionalStableText(candidate.previousRecipientUid, 128)
  const recipients = candidate.recipientCandidates
  if (
    candidate.stream !== expectedStream
    || !['D30', 'D7', 'D1', 'expired'].includes(String(candidate.phase))
    || candidate.sourceType !== 'offboarding_task'
    || candidate.taskType !== taskTypeForStream(expectedStream)
    || !sourceId || !sourceCode || !sourceName || !caseCode || !taskCode
    || sourceCode !== taskCode
    || !dueAt || !eventVersion || !idempotencyKey || !actionableKey
    || !Array.isArray(recipients)
    || recipients.length !== 1
    || explicitUid(recipients[0]) !== recipients[0]
    || (candidate.previousEventVersion !== undefined && candidate.previousEventVersion !== null && !previousEventVersion)
    || (candidate.previousRecipientUid !== undefined && candidate.previousRecipientUid !== null && !previousRecipientUid)
  ) contractError('candidate values')

  return {
    stream: expectedStream,
    phase: candidate.phase as PeopleOffboardingPhase,
    sourceType: 'offboarding_task',
    sourceId,
    sourceCode,
    sourceName,
    caseCode,
    taskCode,
    taskType: candidate.taskType as PeopleOffboardingTaskType,
    dueAt,
    recipientCandidates: [recipients[0]],
    eventVersion,
    ...(candidate.previousEventVersion !== undefined ? { previousEventVersion } : {}),
    ...(candidate.previousRecipientUid !== undefined ? { previousRecipientUid } : {}),
    idempotencyKey,
    actionableKey
  }
}

export function requirePeopleOffboardingClosure(
  value: unknown,
  expectedStream: PeopleOffboardingStream
): PeopleOffboardingClosure {
  const closure = record(value)
  const required = [
    'checkpointEventVersion', 'expectedVersion', 'actionableKey', 'sourceType',
    'sourceId', 'caseCode', 'taskCode', 'taskType', 'recipientUid', 'nextVersion', 'state'
  ]
  if (!closure || !exactKeys(closure, required)) contractError('closure shape')
  const sourceId = positiveInteger(closure.sourceId)
  const caseCode = stableText(closure.caseCode, 64)
  const taskCode = stableText(closure.taskCode, 64)
  const recipientUid = explicitUid(closure.recipientUid)
  const checkpointEventVersion = stableText(closure.checkpointEventVersion, 256)
  const expectedVersion = stableText(closure.expectedVersion, 256)
  const actionableKey = stableText(closure.actionableKey, 191)
  const nextVersion = stableText(closure.nextVersion, 256)
  if (
    closure.sourceType !== 'offboarding_task'
    || !sourceId || !caseCode || !taskCode || !recipientUid
    || closure.taskType !== taskTypeForStream(expectedStream)
    || !checkpointEventVersion || !expectedVersion || !actionableKey || !nextVersion
    || !['resolved', 'cancelled'].includes(String(closure.state))
  ) contractError('closure values')
  return {
    checkpointEventVersion,
    expectedVersion,
    actionableKey,
    sourceType: 'offboarding_task',
    sourceId,
    caseCode,
    taskCode,
    taskType: closure.taskType as PeopleOffboardingTaskType,
    recipientUid,
    nextVersion,
    state: closure.state as PeopleOffboardingClosure['state']
  }
}

export function requirePeopleOffboardingRuntimePage(
  value: unknown,
  expectedStream: PeopleOffboardingStream,
  expectedAsOf: string
) {
  const page = record(value)
  if (!page || !exactKeys(page, ['stream', 'asOf', 'items', 'closures', 'nextCursor'])) {
    contractError('page shape')
  }
  if (page.stream !== expectedStream || page.asOf !== expectedAsOf) contractError('page identity')
  if (!Array.isArray(page.items) || !Array.isArray(page.closures)) contractError('page collections')
  const nextCursor = page.nextCursor === null ? null : stableText(page.nextCursor, 2048)
  if (page.nextCursor !== null && !nextCursor) contractError('page cursor')
  return {
    stream: expectedStream,
    asOf: expectedAsOf,
    items: page.items.map(item => requirePeopleOffboardingCandidate(item, expectedStream)),
    closures: page.closures.map(item => requirePeopleOffboardingClosure(item, expectedStream)),
    nextCursor
  }
}

export function peopleOffboardingNotificationsEnabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
}

export async function resolvePeopleOffboardingRecipient(
  candidate: PeopleOffboardingCandidate,
  findActiveUser: (uid: string) => Promise<DirectoryUser | null>
) {
  const uid = explicitUid(candidate.recipientCandidates[0])
  if (!uid) return null
  const user = await findActiveUser(uid)
  const status = user?.status
  return explicitUid(user?.uid) === uid && (status === 1 || status === 'active') ? uid : null
}

export function peopleOffboardingEventType(stream: PeopleOffboardingStream) {
  return stream === 'offboarding_handover_due'
    ? 'people.offboarding.handover_due'
    : 'people.offboarding.asset_recovery_due'
}

export function peopleOffboardingAuthorizationDescriptor(candidate: PeopleOffboardingCandidate) {
  return { resource: 'offboarding_task' as const, id: candidate.taskCode }
}

export function peopleOffboardingMessage(candidate: PeopleOffboardingCandidate) {
  const label = candidate.taskType === 'handover' ? '离职交接任务' : '离职资产回收协调任务'
  return {
    title: `${label} ${candidate.phase}：${candidate.taskCode}`,
    description: `${candidate.sourceName}；截止时间 ${candidate.dueAt}`,
    url: `/people/offboarding-cases/${encodeURIComponent(candidate.caseCode)}?task=${encodeURIComponent(candidate.taskCode)}`,
    buttonText: '查看离职任务'
  }
}
