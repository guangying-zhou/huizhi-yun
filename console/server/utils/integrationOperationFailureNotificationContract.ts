import { createError } from 'h3'

export interface IntegrationOperationNotificationActor {
  appCode?: string | null
  tenantCode?: string | null
  deploymentCode?: string | null
}

export interface IntegrationOperationFailureNotificationInput {
  tenantCode: string
  deploymentCode: string
  sourceApp: 'aims' | 'altoc' | 'assets' | 'finance' | 'people'
  targetApp: string
  operationId: string
  operationCode: string
  sourceBizType: string
  sourceBizCode: string
  attemptCount: number
  maxAttempts: number
  lastErrorCode: string | null
  lastErrorClass: string | null
  deadLetteredAt: string
  originalActorUid: string | null
  generation: number | null
  operationVersion: number | null
  actionableKey: string | null
  objectVersion: string | null
}

export function integrationOperationActionableMetadata(input: IntegrationOperationFailureNotificationInput) {
  return input.generation && input.operationVersion && input.actionableKey && input.objectVersion
    ? {
        actionableState: 'pending',
        actionableKey: input.actionableKey,
        targetAppCode: input.sourceApp,
        actionTargetAppCode: input.sourceApp,
        objectVersion: input.objectVersion,
        eventVersion: input.objectVersion,
        bizKey: `${input.sourceApp}:integration_operation:${input.operationId}`,
        authorizationDescriptor: { resource: 'integration_operation', id: input.operationId },
        generation: input.generation,
        operationVersion: input.operationVersion
      }
    : {}
}

export function integrationOperationActionUrl(
  input: Pick<IntegrationOperationFailureNotificationInput, 'sourceApp' | 'operationId'>,
  appBaseUrl = ''
) {
  const pagePath = input.sourceApp === 'altoc'
    ? '/admin/integration-operations'
    : '/integration-operations'
  const base = appBaseUrl.replace(/\/+$/, '')
  return `${base}${pagePath}?${new URLSearchParams({ status: 'dead_letter', operationId: input.operationId }).toString()}`
}

const allowedSourceApps = new Set(['aims', 'altoc', 'assets', 'finance', 'people'])
const allowedInputKeys = new Set([
  'tenantCode', 'deploymentCode', 'sourceApp', 'targetApp', 'operationId',
  'operationCode', 'sourceBizType', 'sourceBizCode', 'attemptCount', 'maxAttempts',
  'lastErrorCode', 'lastErrorClass', 'deadLetteredAt', 'originalActorUid',
  'generation', 'operationVersion', 'actionableKey', 'objectVersion'
])

function text(value: unknown) {
  return String(value || '').trim()
}

function requiredCode(value: unknown, field: string, maxLength = 191) {
  const normalized = text(value)
  if (!normalized || normalized.length > maxLength || !/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/.test(normalized)) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

function nullableCode(value: unknown, field: string, maxLength = 100) {
  const normalized = text(value)
  if (!normalized) return null
  if (normalized.length > maxLength || !/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/.test(normalized)) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

function requiredOperationId(value: unknown) {
  const normalized = text(value).toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw createError({ statusCode: 400, message: 'operationId is invalid' })
  }
  return normalized
}

function boundedCount(value: unknown, field: string) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 1_000_000) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

function positiveVersion(value: unknown, field: string) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

export function validateIntegrationOperationFailureNotificationInput(
  raw: unknown,
  actor: IntegrationOperationNotificationActor
): IntegrationOperationFailureNotificationInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createError({ statusCode: 400, message: 'notification payload is invalid' })
  }
  const input = raw as Record<string, unknown>
  const unknownKeys = Object.keys(input).filter(key => !allowedInputKeys.has(key))
  if (unknownKeys.length > 0) {
    throw createError({ statusCode: 400, message: `notification payload contains unsupported fields: ${unknownKeys.join(', ')}` })
  }

  const sourceApp = requiredCode(input.sourceApp, 'sourceApp', 64)
  if (!allowedSourceApps.has(sourceApp) || sourceApp !== text(actor.appCode)) {
    throw createError({ statusCode: 403, message: 'sourceApp does not match the verified service identity' })
  }
  const tenantCode = requiredCode(input.tenantCode, 'tenantCode', 100)
  const deploymentCode = requiredCode(input.deploymentCode, 'deploymentCode', 100)
  if (!actor.tenantCode || tenantCode !== actor.tenantCode || !actor.deploymentCode || deploymentCode !== actor.deploymentCode) {
    throw createError({ statusCode: 403, message: 'tenant or deployment does not match the verified service identity' })
  }

  const deadLetteredAt = text(input.deadLetteredAt)
  if (!deadLetteredAt || Number.isNaN(Date.parse(deadLetteredAt))) {
    throw createError({ statusCode: 400, message: 'deadLetteredAt is invalid' })
  }

  const frozenFields = ['generation', 'operationVersion', 'actionableKey', 'objectVersion']
  const presentFrozenFields = frozenFields.filter(key => input[key] !== undefined && input[key] !== null && input[key] !== '')
  if (presentFrozenFields.length > 0 && presentFrozenFields.length !== frozenFields.length) {
    throw createError({ statusCode: 400, message: 'source-frozen actionable identity is incomplete' })
  }
  const hasFrozenActionable = presentFrozenFields.length === frozenFields.length
  const attemptCount = boundedCount(input.attemptCount, 'attemptCount')
  const operationId = requiredOperationId(input.operationId)
  const deadLetteredAtISO = new Date(deadLetteredAt).toISOString()
  return {
    tenantCode,
    deploymentCode,
    sourceApp: sourceApp as IntegrationOperationFailureNotificationInput['sourceApp'],
    targetApp: requiredCode(input.targetApp, 'targetApp', 64),
    operationId,
    operationCode: requiredCode(input.operationCode, 'operationCode'),
    sourceBizType: requiredCode(input.sourceBizType, 'sourceBizType', 64),
    sourceBizCode: requiredCode(input.sourceBizCode, 'sourceBizCode'),
    attemptCount,
    maxAttempts: boundedCount(input.maxAttempts, 'maxAttempts'),
    lastErrorCode: nullableCode(input.lastErrorCode, 'lastErrorCode'),
    lastErrorClass: nullableCode(input.lastErrorClass, 'lastErrorClass', 50),
    deadLetteredAt: deadLetteredAtISO,
    originalActorUid: nullableCode(input.originalActorUid, 'originalActorUid'),
    generation: hasFrozenActionable ? positiveVersion(input.generation, 'generation') : null,
    operationVersion: hasFrozenActionable ? positiveVersion(input.operationVersion, 'operationVersion') : null,
    actionableKey: hasFrozenActionable
      ? requiredCode(input.actionableKey, 'actionableKey')
      : null,
    objectVersion: hasFrozenActionable
      ? requiredCode(input.objectVersion, 'objectVersion')
      : null
  }
}
