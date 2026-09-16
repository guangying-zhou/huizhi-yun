export type AssetsDueStream
  = | 'resource_expiry'
    | 'ip_expiry'
    | 'delivery_expiry'
    | 'delivery_warranty'
    | 'delivery_support'
    | 'offboarding_unrecovered'
export type AssetsDuePhase = 'D30' | 'D7' | 'D1' | 'expired'

export interface AssetsDueCandidate {
  stream: AssetsDueStream
  phase: AssetsDuePhase
  sourceType: 'asset_item' | 'ip_asset' | 'customer_delivery_asset' | 'offboarding_recovery_case'
  sourceId: number
  sourceCode: string
  sourceName: string
  publicId?: string | null
  dueAt: string
  recipientCandidates: string[]
  eventVersion: string
  previousEventVersion?: string | null
  previousRecipientUid?: string | null
  idempotencyKey: string
  actionableKey: string
}

export interface AssetsDueClosure {
  checkpointEventVersion: string
  expectedVersion: string
  actionableKey: string
  sourceType: 'asset_item' | 'ip_asset' | 'customer_delivery_asset' | 'offboarding_recovery_case'
  sourceId: number
  recipientUid: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
}

export interface DirectoryUser {
  uid?: string
  status?: number | string
}

export interface AssetsDueRecipientDependencies {
  findActiveUser: (uid: string) => Promise<DirectoryUser | null>
}

function text(value: unknown) {
  return String(value || '').trim()
}

function explicitUid(value: unknown) {
  const uid = text(value)
  return uid && uid.toLowerCase() !== '@all' ? uid : ''
}

function activeDirectoryUser(user: DirectoryUser | null, uid: string) {
  return explicitUid(user?.uid) === uid
    && (user?.status === 1 || user?.status === 'active')
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

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function stableText(value: unknown, maxLength = 256) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maxLength) return ''
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
  if (hasControlCharacter) return ''
  return normalized
}

function optionalStableText(value: unknown, maxLength = 256) {
  if (value === undefined || value === null) return null
  return stableText(value, maxLength) || null
}

function rfc3339(value: unknown) {
  const normalized = stableText(value, 64)
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : ''
}

function dueContractError(message: string): never {
  throw new Error(`Invalid Assets due notification runtime contract: ${message}`)
}

function sourceTypeForStream(stream: AssetsDueStream) {
  if (stream === 'resource_expiry') return 'asset_item'
  if (stream === 'ip_expiry') return 'ip_asset'
  if (stream === 'offboarding_unrecovered') return 'offboarding_recovery_case'
  return 'customer_delivery_asset'
}

export function requireAssetsDueCandidate(value: unknown, expectedStream: AssetsDueStream): AssetsDueCandidate {
  const candidate = record(value)
  const required = [
    'stream', 'phase', 'sourceType', 'sourceId', 'sourceCode', 'sourceName', 'dueAt',
    'recipientCandidates', 'eventVersion', 'idempotencyKey', 'actionableKey'
  ]
  if (!candidate || !exactKeys(candidate, required, [
    'publicId', 'previousEventVersion', 'previousRecipientUid'
  ])) dueContractError('candidate shape')

  const stream = candidate.stream
  const phase = candidate.phase
  const sourceType = candidate.sourceType
  const sourceId = positiveInteger(candidate.sourceId)
  const sourceCode = stableText(candidate.sourceCode, 64)
  const sourceName = stableText(candidate.sourceName, 256)
  const dueAt = rfc3339(candidate.dueAt)
  const recipientCandidates = candidate.recipientCandidates
  const eventVersion = stableText(candidate.eventVersion, 256)
  const idempotencyKey = stableText(candidate.idempotencyKey, 191)
  const actionableKey = stableText(candidate.actionableKey, 191)
  const publicId = optionalStableText(candidate.publicId, 64)
  const previousEventVersion = optionalStableText(candidate.previousEventVersion, 256)
  const previousRecipientUid = optionalStableText(candidate.previousRecipientUid, 128)
  if (
    stream !== expectedStream
    || !['D30', 'D7', 'D1', 'expired'].includes(String(phase))
    || sourceType !== sourceTypeForStream(expectedStream)
    || !sourceId || !sourceCode || !sourceName || !dueAt || !eventVersion || !idempotencyKey || !actionableKey
    || !Array.isArray(recipientCandidates)
    || (expectedStream === 'offboarding_unrecovered' && recipientCandidates.length !== 1)
    || recipientCandidates.some(uid => (
      typeof uid !== 'string'
      || !explicitUid(uid)
      || stableText(uid, 128) !== uid
      || explicitUid(uid) !== uid
    ))
    || (candidate.publicId !== undefined && candidate.publicId !== null && !publicId)
    || (candidate.previousEventVersion !== undefined && candidate.previousEventVersion !== null && !previousEventVersion)
    || (candidate.previousRecipientUid !== undefined && candidate.previousRecipientUid !== null && !previousRecipientUid)
  ) dueContractError('candidate values')

  return {
    stream: expectedStream,
    phase: phase as AssetsDuePhase,
    sourceType: sourceType as AssetsDueCandidate['sourceType'],
    sourceId,
    sourceCode,
    sourceName,
    ...(candidate.publicId !== undefined ? { publicId } : {}),
    dueAt,
    recipientCandidates: [...recipientCandidates],
    eventVersion,
    ...(candidate.previousEventVersion !== undefined ? { previousEventVersion } : {}),
    ...(candidate.previousRecipientUid !== undefined ? { previousRecipientUid } : {}),
    idempotencyKey,
    actionableKey
  }
}

export function requireAssetsDueClosure(value: unknown): AssetsDueClosure {
  const closure = record(value)
  const required = [
    'checkpointEventVersion', 'expectedVersion', 'actionableKey', 'sourceType',
    'sourceId', 'recipientUid', 'nextVersion', 'state'
  ]
  if (!closure || !exactKeys(closure, required)) dueContractError('closure shape')
  const sourceType = closure.sourceType
  const sourceId = positiveInteger(closure.sourceId)
  const state = closure.state
  const checkpointEventVersion = stableText(closure.checkpointEventVersion, 256)
  const expectedVersion = stableText(closure.expectedVersion, 256)
  const actionableKey = stableText(closure.actionableKey, 256)
  const recipientUid = explicitUid(closure.recipientUid)
  const nextVersion = stableText(closure.nextVersion, 256)
  if (
    !['asset_item', 'ip_asset', 'customer_delivery_asset', 'offboarding_recovery_case'].includes(String(sourceType)) || !sourceId
    || !['resolved', 'cancelled'].includes(String(state))
    || !checkpointEventVersion || !expectedVersion || !actionableKey || !recipientUid || !nextVersion
  ) dueContractError('closure values')
  return {
    checkpointEventVersion,
    expectedVersion,
    actionableKey,
    sourceType: sourceType as AssetsDueClosure['sourceType'],
    sourceId,
    recipientUid,
    nextVersion,
    state: state as AssetsDueClosure['state']
  }
}

export function requireAssetsDueRuntimePage(
  value: unknown,
  expectedStream: AssetsDueStream,
  expectedAsOf: string
) {
  const page = record(value)
  if (!page || !exactKeys(page, ['stream', 'asOf', 'items', 'closures', 'nextCursor'])) {
    dueContractError('page shape')
  }
  if (page.stream !== expectedStream || page.asOf !== expectedAsOf) dueContractError('page identity')
  if (!Array.isArray(page.items) || !Array.isArray(page.closures)) dueContractError('page collections')
  const nextCursor = page.nextCursor === null ? null : stableText(page.nextCursor, 2048)
  if (page.nextCursor !== null && !nextCursor) dueContractError('page cursor')
  return {
    stream: expectedStream,
    asOf: expectedAsOf,
    items: page.items.map(item => requireAssetsDueCandidate(item, expectedStream)),
    closures: page.closures.map(requireAssetsDueClosure),
    nextCursor
  }
}

export function assetsDueNotificationsEnabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
}

export function assetsDueRecipientCandidates(candidate: AssetsDueCandidate) {
  return [...new Set((candidate.recipientCandidates || []).map(explicitUid).filter(Boolean))]
}

export async function resolveAssetsDueRecipient(
  candidate: AssetsDueCandidate,
  dependencies: AssetsDueRecipientDependencies
) {
  for (const uid of assetsDueRecipientCandidates(candidate)) {
    const user = await dependencies.findActiveUser(uid)
    if (activeDirectoryUser(user, uid)) return uid
  }
  return null
}

export function assetsDueRecipientTransition(candidate: AssetsDueCandidate, recipientUid: string) {
  const currentRecipientUid = explicitUid(recipientUid)
  const previousEventVersion = text(candidate.previousEventVersion)
  const previousRecipientUid = explicitUid(candidate.previousRecipientUid)
  return {
    previousObjectVersion: previousEventVersion && previousRecipientUid === currentRecipientUid
      ? previousEventVersion
      : null,
    previousRecipientClosure: previousEventVersion
      && previousRecipientUid
      && previousRecipientUid !== currentRecipientUid
      ? { expectedVersion: previousEventVersion, recipientUid: previousRecipientUid }
      : null
  }
}

export function assetsDueEventType(stream: AssetsDueStream) {
  if (stream === 'resource_expiry') return 'assets.resource.expiry_due'
  if (stream === 'ip_expiry') return 'assets.ip.expiry_due'
  if (stream === 'delivery_expiry') return 'assets.delivery.expiry_due'
  if (stream === 'delivery_warranty') return 'assets.delivery.warranty_due'
  if (stream === 'offboarding_unrecovered') return 'assets.offboarding.unrecovered'
  return 'assets.delivery.support_due'
}

export function assetsDueCategory(stream: AssetsDueStream) {
  return stream === 'offboarding_unrecovered' ? 'asset-recovery' : 'asset-expiry'
}

export function assetsDueAuthorizationDescriptor(candidate: AssetsDueCandidate) {
  return { resource: candidate.sourceType, id: candidate.sourceCode }
}

export function assetsDueMessage(candidate: AssetsDueCandidate) {
  const resource = candidate.stream === 'resource_expiry'
  const ip = candidate.stream === 'ip_expiry'
  if (candidate.stream === 'offboarding_unrecovered') {
    return {
      title: `离职资产未回收：${candidate.sourceCode}`,
      description: `${candidate.sourceName}；回收期限 ${candidate.dueAt}`,
      url: `/assets/offboarding-recoveries/${encodeURIComponent(candidate.sourceCode)}`,
      buttonText: '查看回收清单'
    }
  }
  const label = resource
    ? '资源资产到期'
    : ip
      ? '知识产权到期'
      : candidate.stream === 'delivery_expiry'
        ? '客户交付资产到期'
        : candidate.stream === 'delivery_warranty'
          ? '客户交付资产质保到期'
          : '客户交付资产支持服务到期'
  const targetId = resource ? text(candidate.publicId) || String(candidate.sourceId) : String(candidate.sourceId)
  return {
    title: `${label} ${candidate.phase}：${candidate.sourceCode}`,
    description: `${candidate.sourceName}；到期日 ${candidate.dueAt}`,
    url: resource
      ? `/assets/items/${encodeURIComponent(targetId)}`
      : ip
        ? `/assets/ip-assets/${encodeURIComponent(targetId)}`
        : `/assets/customer-delivery-assets/${encodeURIComponent(candidate.sourceCode)}`,
    buttonText: resource ? '查看资源资产' : ip ? '查看知识产权' : '查看交付资产'
  }
}
