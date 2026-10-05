import { randomUUID } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { resolveConsoleRuntimeBaseUrl } from '@hzy/foundation/server/utils/consoleRuntime'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import {
  fetchConsoleServiceJson,
  requestWithServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'
import {
  buildServiceCommandRuntimeHeaders,
  hashServiceCommandPayload,
  maybeCallTenantRuntime
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { serviceCommandSourceClientId } from './serviceCommandIdentity'

type Row = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function consoleBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/', directTarget: true })
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event), event)
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })
  return baseUrl
}

function decodeServiceTokenClaims(token: string) {
  try {
    const encoded = token.split('.')[1] || ''
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
    return record(JSON.parse(atob(normalized)))
  } catch {
    return {}
  }
}

async function callConsole<T>(event: H3Event, capability: string, path: string, init: Record<string, unknown> = {}) {
  return await requestWithServiceAccessToken<T>({
    audience: 'console',
    scope: capability,
    event,
    async request(token) {
      return await fetchConsoleServiceJson<T>(event, appendPath(consoleBaseUrl(event), path), {
        ...init,
        headers: {
          ...trustedServiceRequestHeaders(event, 'console'),
          authorization: `Bearer ${token}`,
          ...record(init.headers)
        }
      })
    }
  })
}

async function callConsoleServiceCommand(
  event: H3Event,
  capability: string,
  operationCode: string,
  path: string,
  command: Row,
  idempotencyKey: string
) {
  return await requestWithServiceAccessToken<Row>({
    audience: 'console',
    scope: capability,
    event,
    async request(token) {
      const claims = decodeServiceTokenClaims(token)
      const forwarded = trustedServiceRequestHeaders(event, 'console')
      const tenantCode = text(claims.tenant || claims.tenant_code || getHeader(event, 'x-hzy-tenant'))
      const sourceDeploymentCode = text(claims.deployment || claims.deployment_code || getHeader(event, 'x-hzy-deployment'))
      const targetDeploymentCode = text(forwarded['x-hzy-deployment'] || process.env.HZY_CONSOLE_TARGET_DEPLOYMENT)
      const sourceClientId = serviceCommandSourceClientId(claims) || 'people.runtime'
      if (!tenantCode || !sourceDeploymentCode || !targetDeploymentCode || !sourceClientId) {
        throw createError({ statusCode: 503, message: 'People HR source service-command binding is incomplete.' })
      }
      const requestId = randomUUID()
      const envelope = {
        operationId: randomUUID(),
        targetApp: 'console',
        operationCode,
        requiredCapability: capability,
        idempotencyKey,
        commandSchemaVersion: 'v1',
        commandSha256: await hashServiceCommandPayload(command),
        command
      }
      const commandHeaders = await buildServiceCommandRuntimeHeaders({
        token,
        method: 'POST',
        requestTarget: path,
        requestId,
        tenantCode,
        sourceDeploymentCode,
        targetDeploymentCode,
        sourceApp: 'people',
        sourceClientId,
        targetApp: 'console',
        envelope
      })
      return await fetchConsoleServiceJson<Row>(event, appendPath(consoleBaseUrl(event), path), {
        method: 'POST',
        timeout: 15_000,
        headers: {
          ...forwarded,
          ...commandHeaders,
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-request-id': requestId
        },
        body: { serviceCommand: envelope }
      })
    }
  })
}

export async function previewDingTalkDepartmentMappings(event: H3Event) {
  return await callConsole<Row>(
    event,
    'console:hr-source-sync:view',
    '/api/v1/console/service/directory/hr-sources/dingtalk/department-mappings',
    { method: 'GET', timeout: 10_000 }
  )
}

export async function assertDingTalkDepartmentMappingsReady(event: H3Event) {
  const response = await previewDingTalkDepartmentMappings(event)
  const preview = Object.prototype.hasOwnProperty.call(response, 'items') ? response : record(response.data)
  const totals = record(preview.totals)
  const values = ['total', 'mapped', 'suggested', 'conflict', 'unmatched']
    .map(key => Number(totals[key]))
  const total = values[0] ?? Number.NaN
  const mapped = values[1] ?? Number.NaN
  const suggested = values[2] ?? Number.NaN
  const conflict = values[3] ?? Number.NaN
  const unmatched = values[4] ?? Number.NaN
  const valid = values.every(value => Number.isSafeInteger(value) && value >= 0)
    && total === mapped + suggested + conflict + unmatched
  const unresolved = suggested + conflict + unmatched
  if (!valid || total !== mapped) {
    throw createError({
      statusCode: 409,
      message: valid && unresolved > 0
        ? `仍有 ${unresolved} 个钉钉部门映射未确认，不能启动同步。`
        : '钉钉部门映射状态无效，不能启动同步。'
    })
  }
}

export async function applyDingTalkDepartmentMappings(
  event: H3Event,
  actorUid: string,
  mappings: unknown[],
  idempotencyKey: string
) {
  const capability = 'console:hr-source-sync:admin'
  const operationCode = 'people.hr-source-sync.dingtalk.department-mappings.apply'
  const path = '/api/v1/console/service/directory/hr-sources/dingtalk/department-mappings'
  const command = { actorUid, mappings }

  const consoleResult = await callConsoleServiceCommand(event, capability, operationCode, path, command, idempotencyKey)

  const consoleData = record(consoleResult.data)
  const aliases = Array.isArray(consoleData.aliases) ? consoleData.aliases : []
  if (aliases.length === 0) return { console: consoleData, people: { aliasesApplied: 0 } }
  const peopleRuntime = await maybeCallTenantRuntime<{ code?: number, data?: Row, message?: string }>(
    event,
    '/v1/people/service/hr-source-sync/dingtalk/departments:remap',
    {
      appCode: 'people',
      scope: 'people:hr-source-department-remap:execute',
      method: 'POST',
      idempotencyKey: `${idempotencyKey}:people`,
      serviceTokenSourceBinding: 'service-client-policy',
      body: { aliases }
    }
  )
  if (!peopleRuntime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is required to finish department migration.' })
  }
  if (peopleRuntime.data.code !== undefined && peopleRuntime.data.code !== 0) {
    throw createError({ statusCode: 502, message: peopleRuntime.data.message || 'People department references could not be remapped.' })
  }
  return { console: consoleData, people: record(peopleRuntime.data.data) }
}

export async function getDingTalkDepartmentChanges(event: H3Event) {
  return await callConsole<Row>(
    event,
    'console:hr-source-sync:view',
    '/api/v1/console/service/directory/hr-sources/dingtalk/department-changes',
    { method: 'GET', timeout: 10_000 }
  )
}

export async function applyDingTalkDepartmentChanges(
  event: H3Event,
  actorUid: string,
  snapshotRunId: number,
  snapshotHash: string,
  departmentCodes: string[],
  idempotencyKey: string
) {
  return await callConsoleServiceCommand(
    event,
    'console:hr-source-sync:admin',
    'people.hr-source-sync.dingtalk.department-changes.apply',
    '/api/v1/console/service/directory/hr-sources/dingtalk/department-changes',
    { actorUid, snapshotRunId, snapshotHash, departmentCodes },
    idempotencyKey
  )
}

export async function startDingTalkPeopleSync(event: H3Event, actorUid: string, idempotencyKey: string) {
  const capability = 'console:hr-source-sync:execute'
  return await callConsoleServiceCommand(
    event,
    capability,
    'people.hr-source-sync.dingtalk.jobs.start',
    '/api/v1/console/service/connector-runtime/people-sync-jobs',
    { actorUid, objectScopes: ['organization', 'people'] },
    idempotencyKey
  )
}

export async function getDingTalkPeopleSync(event: H3Event, jobId: string) {
  return await callConsole<Row>(event, 'console:hr-source-sync:view', `/api/v1/console/service/connector-runtime/people-sync-jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET', timeout: 10_000
  })
}

export async function mutateDingTalkPeopleSync(
  event: H3Event,
  actorUid: string,
  jobId: string,
  action: 'cancel' | 'retry',
  idempotencyKey: string
) {
  return await callConsoleServiceCommand(
    event,
    'console:hr-source-sync:execute',
    `people.hr-source-sync.dingtalk.jobs.${action}`,
    `/api/v1/console/service/connector-runtime/people-sync-jobs/${encodeURIComponent(jobId)}/${action}`,
    { actorUid, jobId },
    idempotencyKey
  )
}
