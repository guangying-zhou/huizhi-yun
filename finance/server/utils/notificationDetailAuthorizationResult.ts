import { createError } from 'h3'

export type FinanceNotificationResource = 'invoice_request' | 'finance_receipt' | 'integration_operation'
export interface FinanceNotificationDescriptor { resource: FinanceNotificationResource, id: string }
export interface FinanceNotificationAuthorizationResult extends FinanceNotificationDescriptor {
  authorized: boolean
  reasonCode: 'allowed' | 'not_found' | 'not_authorized' | 'not_recipient' | 'stale_notification'
}

function unavailable(): never {
  throw createError({ statusCode: 503, message: 'Finance notification authorization is unavailable.' })
}
function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join() === [...keys].sort().join()
}
function code(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized.length <= 100 && ![...normalized].some(character => (character.codePointAt(0) || 0) < 32 || character.codePointAt(0) === 127) ? normalized : ''
}

export function requireFinanceNotificationDescriptor(value: unknown): FinanceNotificationDescriptor {
  const descriptor = record(value)
  const id = code(descriptor?.id)
  const integrationOperation = descriptor?.resource === 'integration_operation'
  const validIntegrationOperation = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  if (!descriptor || !exact(descriptor, ['resource', 'id']) || !['invoice_request', 'finance_receipt', 'integration_operation'].includes(String(descriptor.resource)) || !id || (integrationOperation && !validIntegrationOperation)) unavailable()
  return { resource: descriptor.resource as FinanceNotificationResource, id }
}

export function requireFinanceNotificationAuthorizationResult(value: unknown, expected: FinanceNotificationDescriptor): FinanceNotificationAuthorizationResult {
  const result = record(value)
  if (!result || !exact(result, ['authorized', 'reasonCode', 'resource', 'id']) || result.resource !== expected.resource || result.id !== expected.id) unavailable()
  if (result.authorized === true && result.reasonCode === 'allowed') return { authorized: true, reasonCode: 'allowed', ...expected }
  if (result.authorized === false && ['not_found', 'not_authorized', 'not_recipient', 'stale_notification'].includes(String(result.reasonCode))) {
    return { authorized: false, reasonCode: result.reasonCode as FinanceNotificationAuthorizationResult['reasonCode'], ...expected }
  }
  unavailable()
}
