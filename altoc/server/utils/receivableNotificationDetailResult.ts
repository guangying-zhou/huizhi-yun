import { createError } from 'h3'

export interface AltocReceivableDescriptor { resource: 'receivable_plan', id: string }
export interface AltocIntegrationOperationDescriptor { resource: 'integration_operation', id: string }
export type AltocNotificationDescriptor = AltocReceivableDescriptor | AltocIntegrationOperationDescriptor
function unavailable(): never {
  throw createError({ statusCode: 503, message: 'Altoc notification authorization is unavailable.' })
}
function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join() === [...keys].sort().join()
}
function code(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result && result.length <= 30 ? result : ''
}
function operationId(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result) ? result : ''
}
export function requireAltocNotificationDescriptor(value: unknown): AltocNotificationDescriptor {
  const descriptor = record(value)
  if (!descriptor || !exact(descriptor, ['resource', 'id'])) unavailable()
  if (descriptor.resource === 'receivable_plan') {
    const id = code(descriptor.id)
    if (!id) unavailable()
    return { resource: 'receivable_plan', id }
  }
  if (descriptor.resource === 'integration_operation') {
    const id = operationId(descriptor.id)
    if (!id) unavailable()
    return { resource: 'integration_operation', id }
  }
  unavailable()
}
export function requireAltocReceivableDescriptor(value: unknown): AltocReceivableDescriptor {
  const descriptor = requireAltocNotificationDescriptor(value)
  if (descriptor.resource !== 'receivable_plan') unavailable()
  return descriptor
}
export function requireAltocNotificationAuthorizationResult(value: unknown, expected: AltocNotificationDescriptor) {
  const result = record(value)
  if (!result || !exact(result, ['authorized', 'reasonCode', 'resource', 'id']) || result.resource !== expected.resource || result.id !== expected.id) unavailable()
  if (result.authorized === true && result.reasonCode === 'allowed') return { authorized: true, reasonCode: 'allowed' as const, ...expected }
  const rejected = expected.resource === 'integration_operation'
    ? ['not_found', 'not_recipient', 'stale_notification']
    : ['not_found', 'not_authorized']
  if (result.authorized === false && rejected.includes(String(result.reasonCode))) return { authorized: false, reasonCode: String(result.reasonCode), ...expected }
  unavailable()
}
export function requireAltocReceivableAuthorizationResult(value: unknown, expected: AltocReceivableDescriptor) {
  return requireAltocNotificationAuthorizationResult(value, expected)
}
