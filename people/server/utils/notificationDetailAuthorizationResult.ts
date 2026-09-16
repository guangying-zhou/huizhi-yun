import { createError } from 'h3'

export interface PeopleNotificationAuthorizationDescriptor {
  resource: 'offboarding_task' | 'integration_operation'
  id: string
}

export interface PeopleNotificationDetailAuthorizationResult {
  authorized: boolean
  reasonCode: 'allowed' | 'not_found' | 'not_authorized' | 'not_recipient' | 'stale_notification'
  resource: 'offboarding_task' | 'integration_operation'
  id: string
}

function unavailable(): never {
  throw createError({ statusCode: 503, message: 'People notification authorization is unavailable.' })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n')
}

function stableTaskCode(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > 64) return ''
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
  return hasControlCharacter ? '' : normalized
}

function integrationOperationId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : ''
}

export function requirePeopleNotificationAuthorizationDescriptor(
  value: unknown
): PeopleNotificationAuthorizationDescriptor {
  const descriptor = record(value)
  const resource = descriptor?.resource
  const id = resource === 'integration_operation'
    ? integrationOperationId(descriptor?.id)
    : stableTaskCode(descriptor?.id)
  if (
    !descriptor
    || !exactKeys(descriptor, ['resource', 'id'])
    || (resource !== 'offboarding_task' && resource !== 'integration_operation')
    || !id
  ) unavailable()
  return { resource, id }
}

export function requirePeopleNotificationDetailAuthorizationResult(
  value: unknown,
  expected: PeopleNotificationAuthorizationDescriptor
): PeopleNotificationDetailAuthorizationResult {
  const result = record(value)
  if (
    !result
    || !exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id'])
    || result.resource !== expected.resource
    || result.id !== expected.id
  ) unavailable()

  if (result.authorized === true && result.reasonCode === 'allowed') {
    return { authorized: true, reasonCode: 'allowed', ...expected }
  }
  if (
    result.authorized === false
    && (
      result.reasonCode === 'not_found'
      || (expected.resource === 'offboarding_task' && result.reasonCode === 'not_authorized')
      || (expected.resource === 'integration_operation' && (result.reasonCode === 'not_recipient' || result.reasonCode === 'stale_notification'))
    )
  ) {
    return {
      authorized: false,
      reasonCode: result.reasonCode,
      ...expected
    }
  }
  unavailable()
}
