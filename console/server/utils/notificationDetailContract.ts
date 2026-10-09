export interface NotificationDetailFact {
  notificationId: string
  sourceAppCode: string
  title: string
  summary: string | null
  body: string | null
  actionUrl: string | null
  bizType: string | null
  bizId: string | null
  metadataJson: string | Record<string, unknown> | null
  createdAt: string
  expiresAt: string | null
}

export interface NotificationAuthorizationDescriptor {
  resource: string
  id: string
  bizKey?: string
}

const SUPPORTED_NOTIFICATION_DETAIL_SOURCE_APPS = new Set(['workflow', 'aims', 'assets', 'people', 'finance', 'altoc', 'enterprise'])
const ENTERPRISE_CODOCS_SNAPSHOT_TYPES = new Set(['document_share', 'department_share', 'document_review'])
const SUPPORTED_ASSETS_NOTIFICATION_DETAIL_RESOURCES = new Set([
  'asset_item',
  'ip_asset',
  'customer_delivery_asset',
  'offboarding_recovery_case',
  'integration_operation'
])

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizedAppCode(value: unknown) {
  const code = stringValue(value).toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) ? code : ''
}

export function notificationDetailSourceAuthorizationTarget(sourceAppCodeInput: unknown) {
  const sourceAppCode = normalizedAppCode(sourceAppCodeInput)
  if (!SUPPORTED_NOTIFICATION_DETAIL_SOURCE_APPS.has(sourceAppCode)) return null
  if (sourceAppCode === 'aims' || sourceAppCode === 'assets' || sourceAppCode === 'enterprise') {
    return { audience: 'enterprise', scope: 'enterprise:notification-detail:authorize' }
  }
  return { audience: sourceAppCode, scope: `${sourceAppCode}:notification-details:authorize` }
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function parseMetadata(value: NotificationDetailFact['metadataJson']) {
  if (typeof value !== 'string') return recordValue(value)
  try {
    return recordValue(JSON.parse(value || '{}'))
  } catch {
    return {}
  }
}

function boundedDescriptorValue(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const normalized = stringValue(value)
  if (!normalized || normalized.length > maxLength) return ''
  return [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
    ? ''
    : normalized
}

function normalizedNumericId(value: unknown) {
  const raw = stringValue(value)
  if (!/^\d+$/.test(raw)) return ''
  try {
    return BigInt(raw).toString()
  } catch {
    return ''
  }
}

function normalizedNumericIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(normalizedNumericId).filter(Boolean))]
    .sort((left, right) => {
      const a = BigInt(left)
      const b = BigInt(right)
      return a < b ? -1 : a > b ? 1 : 0
    })
}

export function notificationAuthorizationDescriptor(
  row: Pick<NotificationDetailFact, 'sourceAppCode' | 'bizType' | 'bizId' | 'metadataJson'>
): NotificationAuthorizationDescriptor | null {
  const metadata = parseMetadata(row.metadataJson)
  const sourceAppCode = normalizedAppCode(row.sourceAppCode)
  if (sourceAppCode === 'workflow') {
    const instanceId = normalizedNumericId(metadata.workflowInstanceId || metadata.instanceId)
    if (!instanceId) return null
    const taskIds = normalizedNumericIds(metadata.workflowTaskIds || metadata.taskIds)
    if (taskIds.length > 0) {
      return {
        resource: 'workflow_task',
        id: `instance:${instanceId}:tasks:${taskIds.join(',')}`
      }
    }
    return { resource: 'workflow_instance', id: instanceId }
  }

  if (sourceAppCode === 'aims') {
    if (boundedDescriptorValue(row.bizType, 128) === 'webdev_issue') {
      const id = boundedDescriptorValue(row.bizId, 128)
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return null
      const rawDescriptor = metadata.authorizationDescriptor
      if (rawDescriptor !== undefined) {
        if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) return null
        const descriptor = rawDescriptor as Record<string, unknown>
        if (
          Object.keys(descriptor).sort().join(',') !== 'id,resource'
          || descriptor.resource !== 'webdev_issue'
          || boundedDescriptorValue(descriptor.id, 128) !== id
        ) return null
      }
      return { resource: 'webdev_issue', id }
    }
    const rawDescriptor = metadata.authorizationDescriptor
    if (rawDescriptor && typeof rawDescriptor === 'object' && !Array.isArray(rawDescriptor)) {
      const descriptor = rawDescriptor as Record<string, unknown>
      const resource = boundedDescriptorValue(descriptor.resource, 128)
      const id = boundedDescriptorValue(descriptor.id, 256)
      if (
        Object.keys(descriptor).sort().join(',') === 'id,resource'
        && resource === 'integration_operation'
        && id
        && boundedDescriptorValue(row.bizType, 128) === resource
        && boundedDescriptorValue(row.bizId, 256) === id
      ) return { resource, id }
    }
    const id = normalizedNumericId(metadata.workItemId || row.bizId)
    return id ? { resource: 'work_item', id } : null
  }

  if (sourceAppCode === 'assets') {
    const rawDescriptor = metadata.authorizationDescriptor
    if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) return null
    const descriptor = rawDescriptor as Record<string, unknown>
    if (Object.keys(descriptor).sort().join(',') !== 'id,resource') return null
    const resource = boundedDescriptorValue(descriptor.resource, 128)
    const id = boundedDescriptorValue(descriptor.id, 256)
    if (
      !SUPPORTED_ASSETS_NOTIFICATION_DETAIL_RESOURCES.has(resource)
      || !id
      || boundedDescriptorValue(row.bizType, 128) !== resource
      || boundedDescriptorValue(row.bizId, 256) !== id
    ) return null
    return { resource, id }
  }

  if (sourceAppCode === 'enterprise') {
    if (row.bizType === 'integration_operation' && metadata.notificationKind === 'apf_dead_letter') {
      const descriptor = metadata.authorizationDescriptor as Record<string, unknown> | undefined
      if (!descriptor || Object.keys(descriptor).sort().join(',') !== 'id,resource' || !['altoc', 'finance', 'people'].includes(String(metadata.moduleAppCode)) || descriptor.resource !== `apf_${metadata.moduleAppCode}_dead_letter` || descriptor.id !== row.bizId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(descriptor.id))) return null
      return { resource: String(descriptor.resource), id: String(descriptor.id) }
    }
    if (row.bizType !== 'apf_due_checkpoint' || metadata.notificationKind !== 'apf_due') return null
    const descriptor = metadata.authorizationDescriptor as Record<string, unknown> | undefined
    if (!descriptor || Object.keys(descriptor).sort().join(',') !== 'id,resource' || !['apf_sales_lead_due', 'apf_sales_due', 'apf_billing_due', 'apf_issuance_due', 'apf_reconciliation_due', 'apf_handover_due', 'apf_asset_recovery_due'].includes(String(descriptor.resource)) || descriptor.id !== row.bizId
      || !/^apf-due:(sales-due|billing-due|issuance-due|reconciliation-due|handover-due|asset-recovery-due):[a-z_]+:[1-9][0-9]*:[1-9][0-9]*$/.test(String(descriptor.id))) return null
    const family = String(descriptor.id).split(':')[1]!.replaceAll('-', '_')
    const purpose = family === 'sales_due' && String(descriptor.id).split(':')[2] === 'lead' ? 'apf_sales_lead_due' : `apf_${family}`
    if (descriptor.resource !== purpose) return null
    return { resource: String(descriptor.resource), id: String(descriptor.id) }
  }
  if (sourceAppCode === 'people') {
    const rawDescriptor = metadata.authorizationDescriptor
    if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) return null
    const descriptor = rawDescriptor as Record<string, unknown>
    if (Object.keys(descriptor).sort().join(',') !== 'id,resource') return null
    const resource = boundedDescriptorValue(descriptor.resource, 128)
    const id = boundedDescriptorValue(descriptor.id, 256)
    if (
      !['offboarding_task', 'integration_operation'].includes(resource)
      || !id
      || boundedDescriptorValue(row.bizType, 128) !== resource
      || boundedDescriptorValue(row.bizId, 256) !== id
    ) return null
    return { resource, id }
  }

  if (sourceAppCode === 'finance') {
    const rawDescriptor = metadata.authorizationDescriptor
    if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) return null
    const descriptor = rawDescriptor as Record<string, unknown>
    if (Object.keys(descriptor).sort().join(',') !== 'id,resource') return null
    const resource = boundedDescriptorValue(descriptor.resource, 128)
    const id = boundedDescriptorValue(descriptor.id, 256)
    if (
      !['invoice_request', 'finance_receipt', 'integration_operation'].includes(resource)
      || !id
      || boundedDescriptorValue(row.bizType, 128) !== resource
      || boundedDescriptorValue(row.bizId, 256) !== id
    ) return null
    return { resource, id }
  }

  if (sourceAppCode === 'altoc') {
    const rawDescriptor = metadata.authorizationDescriptor
    if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) return null
    const descriptor = rawDescriptor as Record<string, unknown>
    if (Object.keys(descriptor).sort().join(',') !== 'id,resource') return null
    const resource = boundedDescriptorValue(descriptor.resource, 128)
    const id = boundedDescriptorValue(descriptor.id, 256)
    if (
      !['receivable_plan', 'integration_operation'].includes(resource)
      || !id
      || boundedDescriptorValue(row.bizType, 128) !== resource
      || boundedDescriptorValue(row.bizId, 256) !== id
    ) return null
    return { resource, id }
  }

  if (sourceAppCode === 'console') {
    const rawDescriptor = metadata.authorizationDescriptor
    if (!rawDescriptor) {
      const resource = boundedDescriptorValue(row.bizType, 128)
      const id = boundedDescriptorValue(row.bizId, 256)
      return resource === 'notification_runtime' && id ? { resource, id } : null
    }
    if (typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) return null
    const descriptor = rawDescriptor as Record<string, unknown>
    if (Object.keys(descriptor).sort().join(',') !== 'id,resource') return null
    const resource = boundedDescriptorValue(descriptor.resource, 128)
    const id = boundedDescriptorValue(descriptor.id, 256)
    if (
      !['people_lifecycle_authorization', 'notification_runtime', 'feedback'].includes(resource)
      || !id
      || boundedDescriptorValue(row.bizType, 128) !== resource
      || boundedDescriptorValue(row.bizId, 256) !== id
    ) return null
    return { resource, id }
  }

  const authorization = recordValue(metadata.authorization)
  const resource = stringValue(authorization.resource || metadata.authorizationResource || row.bizType)
  const id = stringValue(authorization.id || metadata.authorizationResourceId || row.bizId)
  const bizKey = stringValue(metadata.bizKey)
  if (!resource || !id) return null
  return {
    resource: resource.slice(0, 128),
    id: id.slice(0, 256),
    ...(bizKey ? { bizKey: bizKey.slice(0, 320) } : {})
  }
}

export function notificationActionTargetAppCode(
  row: Pick<NotificationDetailFact, 'sourceAppCode' | 'metadataJson'>
) {
  const metadata = parseMetadata(row.metadataJson)
  return normalizedAppCode(metadata.actionTargetAppCode || metadata.targetAppCode)
    || normalizedAppCode(row.sourceAppCode)
}

export function notificationDetailResponse(row: NotificationDetailFact) {
  return {
    notificationId: row.notificationId,
    sourceAppCode: row.sourceAppCode,
    title: row.title,
    summary: row.summary,
    body: row.body,
    actionUrl: row.actionUrl,
    actionTargetAppCode: notificationActionTargetAppCode(row),
    bizType: row.bizType,
    bizId: row.bizId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt
  }
}

/** A recipient-bound message snapshot never exposes the current business object. */
export function enterpriseNotificationSnapshotDetail(row: NotificationDetailFact) {
  if (normalizedAppCode(row.sourceAppCode) !== 'enterprise') return null
  const metadata = parseMetadata(row.metadataJson)
  if (
    metadata.notificationKind !== 'business_event'
    || metadata.moduleAppCode !== 'codocs'
    || !ENTERPRISE_CODOCS_SNAPSHOT_TYPES.has(stringValue(row.bizType))
  ) return null
  return {
    notificationId: row.notificationId,
    sourceAppCode: 'enterprise',
    title: row.title,
    summary: row.summary,
    body: row.body,
    actionUrl: null,
    actionTargetAppCode: 'codocs',
    bizType: null,
    bizId: null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    detailMode: 'notification_snapshot' as const
  }
}
