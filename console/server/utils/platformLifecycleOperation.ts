import { createHmac } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { classifyServiceOperationFailure, validateServiceCommandReceipt } from '@hzy/foundation/server/utils/serviceOperation'
import {
  callConsoleTenantRuntimeTask,
  callConsoleTenantRuntimeTaskForEvent
} from './consoleTenantRuntimeTaskClient'
import { loadPlatformRuntimeConfig, platformRuntimeFetch } from './platformRuntime'

type Row = Record<string, unknown>
type PlatformLifecycleCommandEnvelope = { code?: number, success?: boolean, data?: unknown, message?: string }
type PlatformLifecycleCommandFetch = (
  url: string,
  options: { method: 'POST', headers: Record<string, string>, body: Record<string, unknown>, timeout: number }
) => Promise<PlatformLifecycleCommandEnvelope>
export interface PlatformLifecycleCommandRow {
  operationId: string
  tenantCode: string
  deploymentCode: string
  operationCode: string
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  command: Row
  commandSha256: string
}
interface PlatformLifecycleOperationRow extends PlatformLifecycleCommandRow {
  operationKey: string
  fencingToken: number
  attemptCount: number
}
const codes = new Set(['console.platform.employment-sync.v1', 'console.platform.offboarding-revoke.v1'])
const text = (value: unknown) => String(value || '').trim()
const enabled = (value: unknown) => ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
type PlatformLifecycleDrainOptions = { maxClaims?: number, maxDurationMs?: number, claimReserveMs?: number }

export function platformLifecycleDrainEnabled() {
  return enabled(process.env.HZY_CONSOLE_PLATFORM_LIFECYCLE_SYNC_ENABLED)
}

async function runtimeTask<T>(
  event: H3Event | undefined,
  path: `/v1/console/${string}`,
  options: { method?: 'GET' | 'POST', body?: Record<string, unknown>, query?: Record<string, unknown> } = {}
) {
  return event
    ? await callConsoleTenantRuntimeTaskForEvent<T>(event, path, options)
    : await callConsoleTenantRuntimeTask<T>(path, options)
}

async function claimNext(event?: H3Event) {
  const response = await runtimeTask<{ data: PlatformLifecycleOperationRow | null }>(
    event,
    '/v1/console/platform-lifecycle/drain/claim',
    { method: 'POST', body: {} }
  )
  return response.data
}

async function callPlatform(row: PlatformLifecycleCommandRow) {
  if (!codes.has(row.operationCode)) throw createError({ statusCode: 409, message: 'unsupported platform lifecycle operation' })
  const config = loadPlatformRuntimeConfig()
  const command = row.command
  const employment = row.operationCode === 'console.platform.employment-sync.v1'
  const capability = employment ? 'platform:employment-authorization:sync' : 'platform:offboarding-authorization:revoke'
  if (row.requiredCapability !== capability) throw createError({ statusCode: 409, message: 'platform lifecycle capability mismatch' })
  const sourceDeployment = text(command.sourceDeploymentCode)
  if (!sourceDeployment) throw createError({ statusCode: 409, message: 'platform lifecycle source deployment binding is missing' })
  const path = `/api/platform/internal/authorization/users/${encodeURIComponent(text(command.employeeUid))}/${employment ? 'employment' : 'offboarding'}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const targetDeployment = 'platform-control-plane'
  const binding = `POST\n${path}\n${row.tenantCode}\n${sourceDeployment}\n${targetDeployment}\nconsole\nplatform\n${row.operationId}\n${row.operationCode}\n${row.requiredCapability}\n${row.idempotencyKey}\n${row.commandSchemaVersion}\n${row.commandSha256}\n${text(command.originalActorUid)}\n${timestamp}`
  const signature = createHmac('sha256', config.platformServiceToken).update(binding).digest('hex')
  // Trusted lifecycle commands must use the same-account Worker binding. The
  // public edge applies geo WAF rules to cron-originated Worker subrequests.
  const fetchPlatform = platformRuntimeFetch as unknown as PlatformLifecycleCommandFetch
  const response = await fetchPlatform(`${config.baseUrl}${path}`, {
    method: 'POST', headers: { 'authorization': `Bearer ${config.platformServiceToken}`, 'x-hzy-internal-principal': 'console-directory-runtime', 'x-hzy-tenant': row.tenantCode, 'x-hzy-service-command-source-deployment': sourceDeployment, 'x-hzy-service-command-target-deployment': targetDeployment, 'x-hzy-service-command-timestamp': timestamp, 'x-hzy-service-command-signature': signature },
    body: { serviceCommand: { sourceApp: 'console', sourceDeployment, targetDeployment, operationId: row.operationId, targetApp: 'platform', operationCode: row.operationCode, requiredCapability: row.requiredCapability, idempotencyKey: row.idempotencyKey, commandSchemaVersion: row.commandSchemaVersion, commandSha256: row.commandSha256, command } }, timeout: 10_000
  })
  if (response.code !== 0 && response.success !== true) throw createError({ statusCode: 502, message: response.message || 'Platform lifecycle command failed.' })
  return response.data
}

export async function executePlatformLifecycleRetryCommand(row: PlatformLifecycleCommandRow) {
  const raw = await callPlatform(row)
  const command = row.command
  return validateServiceCommandReceipt({
    operationId: row.operationId,
    targetApp: 'platform',
    operationCode: row.operationCode,
    requiredCapability: row.requiredCapability,
    idempotencyKey: row.idempotencyKey,
    commandSchemaVersion: row.commandSchemaVersion,
    commandSha256: row.commandSha256,
    command
  }, raw, {
    targetBizType: 'authorization_subject',
    targetBizCode: text(command.employeeUid)
  })
}

async function execute(row: PlatformLifecycleOperationRow, event?: H3Event) {
  try {
    const receipt = await executePlatformLifecycleRetryCommand(row)
    await runtimeTask(
      event,
      '/v1/console/platform-lifecycle/drain/checkpoint',
      {
        method: 'POST',
        body: {
          operationId: row.operationId,
          fencingToken: row.fencingToken,
          outcome: 'succeeded',
          receipt
        }
      }
    )
    return true
  } catch (error) {
    const failure = classifyServiceOperationFailure(error)
    const status = failure.retryable ? (failure.networkError || failure.timedOut ? 'partial_unknown' : 'retry_wait') : 'failed_permanent'
    await runtimeTask(
      event,
      '/v1/console/platform-lifecycle/drain/checkpoint',
      {
        method: 'POST',
        body: {
          operationId: row.operationId,
          fencingToken: row.fencingToken,
          outcome: 'failed',
          failure: {
            status,
            code: failure.code,
            classification: failure.classification,
            summary: failure.summary
          }
        }
      }
    )
    return false
  }
}

async function drainPlatformLifecycleOperationsWithEvent(
  event: H3Event | undefined,
  options: PlatformLifecycleDrainOptions = {}
) {
  if (!platformLifecycleDrainEnabled()) return { enabled: false, claimed: 0, succeeded: 0 }
  const started = Date.now()
  const maxDuration = Math.min(45_000, options.maxDurationMs || 45_000)
  const claimReserve = Math.min(maxDuration, Math.max(10_000, options.claimReserveMs || 25_000))
  const maxClaims = Math.min(20, options.maxClaims || 20)
  const operations: PlatformLifecycleOperationRow[] = []
  let claimFailure: unknown
  while (operations.length < maxClaims && maxDuration - (Date.now() - started) >= claimReserve) {
    try {
      const row = await claimNext(event)
      if (!row) break
      operations.push(row)
    } catch (error) {
      claimFailure = error
      break
    }
  }
  const results = await Promise.allSettled(operations.map(row => execute(row, event)))
  if (claimFailure) throw claimFailure
  const succeeded = results.reduce((count, result) =>
    count + (result.status === 'fulfilled' && result.value ? 1 : 0), 0)
  return { enabled: true, claimed: operations.length, succeeded }
}

export async function drainPlatformLifecycleOperations(options: PlatformLifecycleDrainOptions = {}) {
  return await drainPlatformLifecycleOperationsWithEvent(undefined, options)
}

export async function drainPlatformLifecycleOperationsForEvent(
  event: H3Event,
  options: PlatformLifecycleDrainOptions = {}
) {
  return await drainPlatformLifecycleOperationsWithEvent(event, options)
}
