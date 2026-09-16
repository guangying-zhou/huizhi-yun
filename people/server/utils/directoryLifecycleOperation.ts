import { createError, type H3Event } from 'h3'
import { resolveConsoleRuntimeBaseUrl } from '@hzy/foundation/server/utils/consoleRuntime'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import {
  fetchConsoleServiceJson,
  requestWithServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  buildServiceCommandEnvelope
} from '@hzy/foundation/server/utils/serviceOperation'
import {
  type ClaimedDirectoryLifecycleOperation,
  directoryLifecycleOperationContract,
  executeDirectoryLifecycleOperation
} from './directoryLifecycleExecution'
import { prepareDueDirectoryLifecycleOperations } from './directoryLifecyclePreparation'
import { callPeopleScheduledRuntime, requirePeopleScheduledRuntimeBinding } from './scheduledRuntime'

type Row = Record<string, unknown>
type ClaimedOperation = ClaimedDirectoryLifecycleOperation

const employmentCode = 'people.directory.employment-sync.v1'
const offboardingCode = 'people.directory.offboarding-disable.v1'

const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const enabled = (value: unknown) => ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())

export function directoryLifecycleDrainEnabled() {
  const config = useRuntimeConfig() as unknown as Row
  return enabled(record(record(config.hzy).projections).directoryLifecycleEnabled ?? process.env.HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED)
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function callConsole(event: H3Event | null, operation: ClaimedOperation, targetDeploymentOverride = '') {
  const { command, employment, capability } = directoryLifecycleOperationContract(operation)
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/', directTarget: true })
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event || undefined), event)
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })
  const targetDeployment = text(targetDeploymentOverride || process.env.HZY_CONSOLE_TARGET_DEPLOYMENT)
  if (!targetDeployment) throw createError({ statusCode: 503, message: 'Console target deployment binding is not configured.' })
  const uid = text(command.employeeUid)
  const action = employment ? 'employment' : 'disable'
  return await requestWithServiceAccessToken({ audience: 'console', scope: capability, event, async request(token) {
    const path = `/api/v1/console/service/directory/users/${encodeURIComponent(uid)}/${action}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const message = `POST\n${path}\n${text(operation.tenantCode)}\n${text(operation.deploymentCode)}\n${targetDeployment}\npeople\nconsole\n${text(operation.operationId)}\n${text(operation.operationCode)}\n${text(operation.requiredCapability)}\n${text(operation.idempotencyKey)}\n${text(operation.commandSchemaVersion)}\n${text(operation.commandSha256)}\n${text(command.originalActorUid)}\n${timestamp}`
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const envelope = buildServiceCommandEnvelope(operation)
    ;(envelope.serviceCommand as Record<string, unknown>).sourceApp = 'people'
    ;(envelope.serviceCommand as Record<string, unknown>).sourceDeployment = text(operation.deploymentCode)
    ;(envelope.serviceCommand as Record<string, unknown>).targetDeployment = targetDeployment
    const response = await fetchConsoleServiceJson<{ code?: number | string, message?: string, data?: unknown }>(
      event,
      appendPath(baseUrl, path),
      {
        method: 'POST',
        headers: {
          ...trustedServiceRequestHeaders(event),
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': text(operation.idempotencyKey),
          'x-hzy-tenant': text(operation.tenantCode),
          'x-forwarded-prefix': '/',
          'x-hzy-service-command-source-deployment': text(operation.deploymentCode),
          'x-hzy-service-command-target-deployment': targetDeployment,
          'x-hzy-service-command-timestamp': timestamp,
          'x-hzy-service-command-signature': signature
        },
        body: envelope,
        timeout: 10_000
      }
    )
    if (response.code !== undefined && String(response.code) !== '0') throw createError({ statusCode: 502, message: response.message || 'Console Directory lifecycle command failed.' })
    return record(response.data)
  } })
}

export async function dispatchDirectoryLifecycleOperation(event: H3Event, operationKey: string) {
  const runtime = (path: string, body: Row) => callPeopleRuntimeForEvent(event, path, body)
  try {
    const operation = await runtime(`/v1/people/integration-operations/${encodeURIComponent(operationKey)}:claim`, {}) as ClaimedOperation
    if (!text(operation.operationId)) return { linked: true, synced: false, pending: true, operationKey }
    const result = await executeDirectoryLifecycleOperation(operation, event, runtime, callConsole)
    const targetResult = record(result.result)
    const chainPending = Boolean(text(targetResult.platformOperationKey)) && text(targetResult.platformStatus) !== 'succeeded'
    return { ...result, chainPending, pending: result.pending || chainPending, operationKey }
  } catch (error) {
    return { linked: true, synced: false, pending: true, operationKey, errorCode: text((error as { statusMessage?: unknown }).statusMessage) || 'delivery_pending' }
  }
}

async function callPeopleRuntimeForEvent(event: H3Event, path: string, body: Row) {
  const result = await maybeCallTenantRuntime<{ code?: number, data?: Row, message?: string }>(event, path, {
    appCode: 'people',
    scope: 'people.write people:integration_operation:execute',
    method: 'POST',
    body
  })
  if (!result.handled) throw createError({ statusCode: 503, message: 'People operation runtime unavailable.' })
  if (result.data.code !== undefined && result.data.code !== 0) {
    throw createError({ statusCode: 503, message: result.data.message || 'People operation runtime unavailable.' })
  }
  return record(result.data.data)
}

type DirectoryLifecycleBinding = {
  tenant: string
  deployment: string
  consoleTargetDeployment?: string
}

type DirectoryLifecycleDrainOptions = {
  maxClaims?: number
  maxDurationMs?: number
  claimReserveMs?: number
}

async function drainDirectoryLifecycleWithRuntime(
  binding: DirectoryLifecycleBinding,
  runtime: (path: string, body: Row) => Promise<Row>,
  target: (operation: ClaimedOperation) => Promise<Row>,
  options: DirectoryLifecycleDrainOptions
) {
  const maxClaims = Math.min(20, Math.max(1, options.maxClaims || 20))
  const started = Date.now()
  const maxDuration = Math.min(45_000, Math.max(12_000, options.maxDurationMs || 45_000))
  const claimReserve = Math.min(maxDuration, Math.max(10_000, options.claimReserveMs || 25_000))
  const preparation = await prepareDueDirectoryLifecycleOperations(runtime, {
    asOf: new Date().toISOString(),
    limit: 20,
    maxPages: 5,
    deadlineAt: started + maxDuration - claimReserve
  })
  const operations: ClaimedOperation[] = []
  let claimFailure: unknown
  while (operations.length < maxClaims && maxDuration - (Date.now() - started) >= claimReserve) {
    try {
      const operation = await runtime('/v1/people/integration-operations:claim-next', { operationFamily: 'directory-lifecycle' }) as ClaimedOperation
      if (!text(operation?.operationId)) break
      if (
        ![employmentCode, offboardingCode].includes(text(operation.operationCode))
        || text(operation.tenantCode) !== text(binding.tenant)
        || text(operation.deploymentCode) !== text(binding.deployment)
        || text(operation.sourceApp) !== 'people'
        || text(operation.targetApp) !== 'console'
      ) {
        throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'People lifecycle operation escaped its scheduled tenant/deployment binding.' })
      }
      operations.push(operation)
    } catch (error) {
      claimFailure = error
      break
    }
  }
  const results = await Promise.allSettled(operations.map(operation =>
    executeDirectoryLifecycleOperation(operation, null, runtime, (_event, current) => target(current))))
  if (claimFailure) throw claimFailure
  const succeeded = results.reduce((count, result) =>
    count + (result.status === 'fulfilled' && result.value.synced ? 1 : 0), 0)
  return { enabled: true, tenant: binding.tenant, deployment: binding.deployment, preparation, claimed: operations.length, succeeded }
}

export async function drainDirectoryLifecycleOperations(options: DirectoryLifecycleDrainOptions = {}) {
  if (!directoryLifecycleDrainEnabled()) return { enabled: false, claimed: 0, succeeded: 0 }
  const binding = requirePeopleScheduledRuntimeBinding()
  const runtime = (path: string, body: Row) => callPeopleScheduledRuntime<Row>(path, { scope: 'people.write people:integration_operation:execute', body })
  return await drainDirectoryLifecycleWithRuntime(
    binding,
    runtime,
    operation => callConsole(null, operation),
    options
  )
}

export async function drainDirectoryLifecycleOperationsForEvent(
  event: H3Event,
  binding: DirectoryLifecycleBinding,
  options: DirectoryLifecycleDrainOptions = {}
) {
  if (!text(binding.consoleTargetDeployment)) {
    throw createError({ statusCode: 503, message: 'Console target deployment binding is not configured.' })
  }
  const runtime = (path: string, body: Row) => callPeopleRuntimeForEvent(event, path, body)
  return await drainDirectoryLifecycleWithRuntime(
    binding,
    runtime,
    operation => callConsole(event, operation, text(binding.consoleTargetDeployment)),
    options
  )
}
