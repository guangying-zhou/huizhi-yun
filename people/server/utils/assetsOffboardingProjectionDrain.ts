import { createError } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'
import {
  callPeopleScheduledRuntime,
  requirePeopleScheduledRuntimeBinding
} from '~~/server/utils/scheduledRuntime'

type Row = Record<string, unknown>

interface ClaimedProjection extends Row {
  operationId: string
  operationKey: string
  tenantCode: string
  deploymentCode: string
  sourceApp: string
  targetApp: string
  operationCode: string
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  commandSha256: string
  command: Row
  fencingToken: number | string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function enabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
}

export function assetsOffboardingProjectionEnabled() {
  const config = useRuntimeConfig() as unknown as Row
  const hzy = record(config.hzy)
  const projections = record(hzy.projections)
  return enabled(projections.assetsOffboardingEnabled ?? process.env.HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED)
}

function appendPath(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const normalized = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalized.startsWith('api/v1/')) {
    return `${base}/${normalized.slice('api/v1/'.length)}`
  }
  return `${base}/${normalized}`
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function validateClaim(operation: ClaimedProjection, tenant: string, deployment: string) {
  const command = record(operation.command)
  if (
    text(operation.tenantCode) !== tenant
    || text(operation.deploymentCode) !== deployment
    || text(operation.sourceApp) !== 'people'
    || text(operation.targetApp) !== 'assets'
    || text(operation.operationCode) !== 'people.offboarding.assets-recovery-sync.v1'
    || text(operation.requiredCapability) !== 'assets:offboarding-recovery:sync'
    || !text(operation.operationId)
    || !text(operation.operationKey)
    || !text(operation.fencingToken)
    || !text(command.sourceEventKey)
    || !text(command.departedEmployeeUid)
    || Number.isNaN(Date.parse(text(command.offboardedAt)))
  ) {
    throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'People Assets offboarding projection is invalid.' })
  }
  return command
}

async function callAssets(operation: ClaimedProjection) {
  const baseUrl = resolveServiceAppBaseUrl(null, 'assets')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  return await requestWithServiceAccessToken({
    audience: 'assets',
    scope: 'assets:offboarding-recovery:sync',
    async request(token) {
      const response = await $fetch<{ code?: number | string, message?: string, data?: unknown }>(
        appendPath(baseUrl, '/api/v1/service/offboarding-recoveries:upsert'),
        {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json',
            'idempotency-key': text(operation.idempotencyKey)
          },
          body: buildServiceCommandEnvelope(operation),
          timeout: 10_000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Assets offboarding recovery projection failed.' })
      }
      return record(response.data)
    }
  })
}

async function checkpointFailure(operation: ClaimedProjection, error: unknown) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409
    ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
    : {})
  return await callPeopleScheduledRuntime<Row>(
    `/v1/people/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`,
    {
      scope: 'people.write people:integration_operation:execute',
      body: {
        operationId: text(operation.operationId),
        fencingToken: operation.fencingToken,
        httpStatus: failure.statusCode || 0,
        timedOut: failure.timedOut,
        networkError: failure.networkError,
        deliveryUncertain: failure.timedOut || failure.networkError,
        errorCode: failure.code,
        errorSummary: failure.summary,
        ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
      }
    }
  )
}

async function executeProjection(operation: ClaimedProjection, tenant: string, deployment: string) {
  let command: Row
  try {
    command = validateClaim(operation, tenant, deployment)
  } catch (error) {
    await checkpointFailure(operation, error)
    return false
  }
  try {
    const rawReceipt = await callAssets(operation)
    const expectedCaseCode = `AOR-${(await sha256(`people|${text(command.sourceEventKey)}`)).slice(0, 16).toUpperCase()}`
    const receipt = validateServiceCommandReceipt(operation, rawReceipt, {
      targetBizType: 'offboarding_recovery_case',
      targetBizCode: expectedCaseCode
    })
    await callPeopleScheduledRuntime<Row>(
      `/v1/people/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`,
      {
        scope: 'people.write people:integration_operation:execute',
        body: {
          operationId: text(operation.operationId),
          fencingToken: operation.fencingToken,
          targetReceiptId: receipt.receiptId,
          receiptOperationId: receipt.operationId,
          receiptOperationCode: receipt.operationCode,
          receiptIdempotencyKey: receipt.idempotencyKey,
          receiptCommandSchemaVersion: receipt.commandSchemaVersion,
          receiptCommandSha256: receipt.commandSha256,
          targetBizType: receipt.targetBizType,
          targetBizCode: receipt.targetBizCode,
          responseSummarySha256: receipt.responseSummarySha256
        }
      }
    )
    return true
  } catch (error) {
    await checkpointFailure(operation, error)
    return false
  }
}

export async function drainAssetsOffboardingProjections(options: { limit?: number, maxClaims?: number } = {}) {
  // Rollout gate is intentionally checked before runtime binding, token, Directory or network access.
  if (!assetsOffboardingProjectionEnabled()) {
    return { enabled: false, prepared: 0, claimed: 0, succeeded: 0 }
  }
  const binding = requirePeopleScheduledRuntimeBinding()
  const asOf = new Date().toISOString()
  const limit = Math.min(200, Math.max(1, options.limit || 100))
  const maxClaims = Math.min(25, Math.max(1, options.maxClaims || 20))
  let preparedCount = 0
  let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const preparedPage: { created?: number, nextCursor?: string | null } = await callPeopleScheduledRuntime<{ created?: number, nextCursor?: string | null }>(
      '/v1/people/service/assets-offboarding-projections:prepare',
      {
        scope: 'people.write people:integration_operation:execute',
        body: { asOf, limit, ...(cursor ? { cursor } : {}) }
      }
    )
    preparedCount += Number(preparedPage?.created || 0)
    cursor = text(preparedPage?.nextCursor) || null
    if (!cursor) break
  }
  let claimed = 0
  let succeeded = 0
  while (claimed < maxClaims) {
    const operation = await callPeopleScheduledRuntime<ClaimedProjection | null>(
      '/v1/people/integration-operations:claim-next',
      { scope: 'people.write people:integration_operation:execute', body: { operationFamily: 'assets-offboarding' } }
    )
    if (!operation) break
    claimed += 1
    if (await executeProjection(operation, binding.tenant, binding.deployment)) succeeded += 1
  }
  return { enabled: true, prepared: preparedCount, claimed, succeeded }
}
