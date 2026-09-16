import { createError } from 'h3'

export interface AssetsNotificationAuthorizationDescriptor {
  resource: 'asset_item' | 'ip_asset' | 'customer_delivery_asset' | 'offboarding_recovery_case' | 'integration_operation'
  id: string
}

export interface AssetsNotificationDetailAuthorizationResult {
  authorized: boolean
  reasonCode: 'allowed' | 'not_found' | 'not_authorized' | 'not_recipient' | 'stale_notification'
  resource: AssetsNotificationAuthorizationDescriptor['resource']
  id: string
}

function unavailable(): never {
  throw createError({ statusCode: 503, message: 'Assets notification authorization is unavailable.' })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown) {
  return String(value || '').trim()
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n')
}

function stableObjectCode(value: unknown) {
  const normalized = text(value)
  if (!normalized || normalized.length > 64) return ''
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
  if (hasControlCharacter) return ''
  return normalized
}

function integrationOperationId(value: unknown) {
  const normalized = text(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : ''
}

export function requireAssetsNotificationAuthorizationDescriptor(
  value: unknown
): AssetsNotificationAuthorizationDescriptor {
  const descriptor = record(value)
  const resource = text(descriptor?.resource)
  const id = stableObjectCode(descriptor?.id)
  if (
    !descriptor
    || !exactKeys(descriptor, ['resource', 'id'])
    || !['asset_item', 'ip_asset', 'customer_delivery_asset', 'offboarding_recovery_case', 'integration_operation'].includes(resource)
    || !id
    || (resource === 'integration_operation' && !integrationOperationId(id))
  ) unavailable()
  return { resource: resource as AssetsNotificationAuthorizationDescriptor['resource'], id }
}

export function requireAssetsNotificationDetailAuthorizationResult(
  value: unknown,
  expectedDescriptor: AssetsNotificationAuthorizationDescriptor
): AssetsNotificationDetailAuthorizationResult {
  const result = record(value)
  if (
    !result
    || !exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id'])
    || result.resource !== expectedDescriptor.resource
    || text(result.id) !== expectedDescriptor.id
  ) unavailable()

  if (result.authorized === true && result.reasonCode === 'allowed') {
    return { authorized: true, reasonCode: 'allowed', ...expectedDescriptor }
  }
  const rejectedReasons = expectedDescriptor.resource === 'integration_operation'
    ? ['not_found', 'not_recipient', 'stale_notification']
    : ['not_found', 'not_authorized']
  const reasonCode = text(result.reasonCode) as AssetsNotificationDetailAuthorizationResult['reasonCode']
  if (result.authorized === false && rejectedReasons.includes(reasonCode)) {
    return {
      authorized: false,
      reasonCode,
      ...expectedDescriptor
    }
  }
  unavailable()
}
