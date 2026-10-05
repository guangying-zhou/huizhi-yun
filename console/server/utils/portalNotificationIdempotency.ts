import { createHash } from 'node:crypto'

export type PortalNotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type PortalActionableState = 'pending' | 'resolved' | 'cancelled'

export interface PortalActionableDescriptor {
  sourceAppCode: string
  actionableKey: string
  targetAppCode: string | null
  bizType: string
  bizId: string
  businessKey: string
  state: PortalActionableState
  objectVersion: string
  previousObjectVersion: string | null
}

export interface PublishPortalNotificationInput {
  sourceAppCode?: unknown
  eventType?: unknown
  category?: unknown
  severity?: unknown
  title?: unknown
  summary?: unknown
  body?: unknown
  actionUrl?: unknown
  bizType?: unknown
  bizId?: unknown
  idempotencyKey?: unknown
  recipients?: unknown
  channels?: unknown
  metadata?: unknown
}

export interface PortalNotificationActor {
  actorId?: string | null
  appCode?: string | null
}

export interface CanonicalPortalNotification {
  sourceAppCode: string
  eventType: string | null
  category: string
  severity: PortalNotificationSeverity
  title: string
  summary: string | null
  body: string | null
  actionUrl: string | null
  bizType: string | null
  bizId: string | null
  idempotencyKey: string
  recipients: string[]
  channels: string[]
  metadata: Record<string, unknown>
  metadataJson: string
  createdBy: string | null
  requestHash: string
  actionable: PortalActionableDescriptor | null
}

export class PortalNotificationPublishError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, message: string, code: string) {
    super(message)
    this.name = 'PortalNotificationPublishError'
    this.statusCode = statusCode
    this.code = code
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableString(value: unknown, maxLength?: number) {
  const normalized = stringValue(value)
  if (!normalized) return null
  return maxLength && normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized
}

export function normalizePortalNotificationActionUrl(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized) return null
  const hasControl = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (normalized.length > 1000 || hasControl || normalized.includes('\\')) {
    throw new PortalNotificationPublishError(400, 'actionUrl must be a safe HTTP(S) URL or application path', 'invalid_action_url')
  }
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized
  try {
    const parsed = new URL(normalized)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('unsafe')
    }
    return normalized
  } catch {
    throw new PortalNotificationPublishError(400, 'actionUrl must be a safe HTTP(S) URL or application path', 'invalid_action_url')
  }
}

function normalizeCode(value: unknown, fallback: string, maxLength = 64) {
  const normalized = stringValue(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (normalized || fallback).slice(0, maxLength)
}

function normalizeSeverity(value: unknown): PortalNotificationSeverity {
  const normalized = stringValue(value || 'info').toLowerCase()
  return ['info', 'success', 'warning', 'error'].includes(normalized)
    ? normalized as PortalNotificationSeverity
    : 'info'
}

function normalizeRecipients(value: unknown) {
  const raw = Array.isArray(value) ? value : stringValue(value).split(/[,\s|]+/)
  const recipients = [...new Set(raw.map(item => stringValue(item)).filter(Boolean))].sort()
  if (recipients.some(uid => uid.toLowerCase() === '@all')) {
    throw new PortalNotificationPublishError(400, 'recipients does not accept @all', 'invalid_recipients')
  }
  if (!recipients.length) {
    throw new PortalNotificationPublishError(400, 'recipients is required', 'invalid_recipients')
  }
  return recipients
}

function normalizeChannels(value: unknown) {
  const raw = Array.isArray(value) ? value : stringValue(value).split(/[,\s|]+/)
  const channels = new Set(raw.map(item => normalizeCode(item, '', 32)).filter(Boolean))
  channels.add('in_app')
  return [...channels].sort()
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalJson((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  try {
    const jsonCompatible = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
    return canonicalJson(jsonCompatible) as Record<string, unknown>
  } catch {
    throw new PortalNotificationPublishError(400, 'metadata must be valid JSON', 'invalid_metadata')
  }
}

function actionableBoundedText(value: unknown, field: string, maxLength: number) {
  const normalized = stringValue(value)
  const hasControl = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!normalized || normalized.length > maxLength || hasControl) {
    throw new PortalNotificationPublishError(400, `${field} is required and must not exceed ${maxLength} characters`, `invalid_${field}`)
  }
  return normalized
}

function optionalActionableBoundedText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === '') return null
  return actionableBoundedText(value, field, maxLength)
}

function actionableTargetAppCode(value: unknown, required: boolean) {
  const normalized = stringValue(value).toLowerCase()
  if (!normalized) {
    if (required) {
      throw new PortalNotificationPublishError(400, 'pending actionable notification requires targetAppCode', 'invalid_target_app_code')
    }
    return null
  }
  if (normalized.length > 64 || !/^[a-z][a-z0-9-]*$/.test(normalized)) {
    throw new PortalNotificationPublishError(400, 'metadata.targetAppCode is invalid', 'invalid_target_app_code')
  }
  return normalized
}

function assertPendingActionTargetCatalogBinding(metadata: Record<string, unknown>, targetAppCode: string) {
  const actionTargetAppCode = stringValue(metadata.actionTargetAppCode).toLowerCase()
  if (metadata.actionTargetCatalogBinding !== 'catalog-v1'
    || !actionTargetAppCode
    || actionTargetAppCode !== targetAppCode) {
    throw new PortalNotificationPublishError(
      400,
      'pending actionable notification requires a Console catalog-bound action target',
      'invalid_action_target'
    )
  }
}

function explicitActionableState(value: unknown): PortalActionableState | null {
  const normalized = stringValue(value).toLowerCase()
  if (!normalized) return null
  if (!['pending', 'resolved', 'cancelled'].includes(normalized)) {
    throw new PortalNotificationPublishError(400, 'metadata.actionableState is invalid', 'invalid_actionable_state')
  }
  return normalized as PortalActionableState
}

function inferredWorkflowPending(input: {
  sourceAppCode: string
  eventType: string | null
  metadata: Record<string, unknown>
}) {
  if (input.sourceAppCode !== 'workflow') return false
  if (['workflow.task.created', 'workflow.task.delegated', 'workflow.instance.resubmitted'].includes(input.eventType || '')) return true
  return input.eventType === 'workflow.instance.rejected'
    && stringValue(input.metadata.rejectStrategy) === 'to_previous'
}

export function derivePortalActionableDescriptor(input: {
  sourceAppCode: string
  eventType: string | null
  category: string
  actionUrl: string | null
  bizType: string | null
  bizId: string | null
  metadata: Record<string, unknown>
}): PortalActionableDescriptor | null {
  const state = explicitActionableState(input.metadata.actionableState)
    || (inferredWorkflowPending(input) ? 'pending' : null)
  if (!state) return null
  const actionableKey = actionableBoundedText(input.metadata.actionableKey, 'actionable_key', 191)
  const objectVersion = actionableBoundedText(input.metadata.objectVersion || input.metadata.eventVersion, 'object_version', 191)
  const previousObjectVersion = optionalActionableBoundedText(input.metadata.previousObjectVersion, 'previous_object_version', 191)
  const bizType = actionableBoundedText(input.bizType, 'biz_type', 64)
  const bizId = actionableBoundedText(input.bizId, 'biz_id', 128)
  const businessKey = actionableBoundedText(input.metadata.bizKey || `${bizType}:${bizId}`, 'business_key', 320)
  const targetAppCode = actionableTargetAppCode(input.metadata.targetAppCode, state === 'pending')
  if (state === 'pending' && !input.actionUrl) {
    throw new PortalNotificationPublishError(400, 'pending actionable notification requires actionUrl', 'invalid_action_url')
  }
  if (state === 'pending' && targetAppCode) {
    assertPendingActionTargetCatalogBinding(input.metadata, targetAppCode)
  }
  return {
    sourceAppCode: input.sourceAppCode,
    actionableKey,
    targetAppCode,
    bizType,
    bizId,
    businessKey,
    state,
    objectVersion,
    previousObjectVersion
  }
}

export function canonicalizePortalNotificationRequest(input: PublishPortalNotificationInput, actor: PortalNotificationActor): CanonicalPortalNotification {
  const actorAppCode = normalizeCode(actor.appCode, '')
  if (!actorAppCode) {
    throw new PortalNotificationPublishError(403, '服务身份缺少绑定应用，不能发布通知', 'source_app_identity_required')
  }
  const sourceAppCode = normalizeCode(input.sourceAppCode || actorAppCode, '')
  if (!sourceAppCode || sourceAppCode !== actorAppCode) {
    throw new PortalNotificationPublishError(403, 'sourceAppCode 与服务身份不匹配', 'source_app_mismatch')
  }
  const title = nullableString(input.title, 255)
  if (!title) throw new PortalNotificationPublishError(400, 'title is required', 'invalid_title')
  const idempotencyKey = stringValue(input.idempotencyKey)
  if (!idempotencyKey || idempotencyKey.length > 191) {
    throw new PortalNotificationPublishError(400, 'idempotencyKey is required and must not exceed 191 characters', 'invalid_idempotency_key')
  }

  const metadata = normalizeMetadata(input.metadata)
  const canonical = {
    sourceAppCode,
    idempotencyKey,
    recipients: normalizeRecipients(input.recipients),
    channels: normalizeChannels(input.channels),
    eventType: nullableString(input.eventType, 128),
    category: normalizeCode(input.category, 'general'),
    severity: normalizeSeverity(input.severity),
    title,
    summary: nullableString(input.summary, 1000),
    body: nullableString(input.body),
    actionUrl: normalizePortalNotificationActionUrl(input.actionUrl),
    bizType: nullableString(input.bizType, 64),
    bizId: nullableString(input.bizId, 128),
    metadata
  }
  const metadataJson = JSON.stringify(metadata)
  const requestHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return {
    ...canonical,
    metadataJson,
    createdBy: nullableString(actor.actorId, 128),
    requestHash,
    actionable: derivePortalActionableDescriptor(canonical)
  }
}
