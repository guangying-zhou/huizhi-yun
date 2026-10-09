import { decodeJwt } from 'jose'
import { createError, type H3Event } from 'h3'
import { resolveTrustedServiceAppRoute } from './serviceAppUrl'
import { requestWithServiceAccessToken, fetchConsoleServiceJson, trustedServiceRequestHeaders } from './serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from './tenantRuntimeClient'
import type { FrozenDirectoryCommand } from './directoryServiceCommand'

export const hrSourceTargets = {
  'mappings': ['admin', 'people.hr-source-sync.dingtalk.department-mappings.apply', '/api/v1/console/service/directory/hr-sources/dingtalk/department-mappings'],
  'changes': ['admin', 'people.hr-source-sync.dingtalk.department-changes.apply', '/api/v1/console/service/directory/hr-sources/dingtalk/department-changes'],
  'jobs-start': ['execute', 'people.hr-source-sync.dingtalk.jobs.start', '/api/v1/console/service/connector-runtime/people-sync-jobs'],
  'jobs-cancel': ['execute', 'people.hr-source-sync.dingtalk.jobs.cancel', 'cancel'],
  'jobs-retry': ['execute', 'people.hr-source-sync.dingtalk.jobs.retry', 'retry']
} as const
export type HRSourceKind = keyof typeof hrSourceTargets
export function hrSourcePath(kind: HRSourceKind, command: Record<string, unknown>) {
  const suffix = hrSourceTargets[kind][2]
  if (suffix.startsWith('/')) return suffix
  if (!/^crj_[A-Za-z0-9_-]{20,64}$/.test(String(command.jobId || ''))) throw createError({ statusCode: 400 })
  return `/api/v1/console/service/connector-runtime/people-sync-jobs/${encodeURIComponent(String(command.jobId))}/${suffix}`
}
export function validateHRSourceClaims(token: string, scope: string, tenant: string, deployment: string) {
  const c = decodeJwt(token)
  const h = c.hzy as { appCode?: string, clientCode?: string } | undefined
  if (c.token_use !== 'service' || c.source_app !== 'enterprise' || h?.appCode !== 'enterprise' || c.client_id !== 'enterprise.runtime' || h?.clientCode !== 'enterprise.runtime' || c.aud !== 'console' || c.target_app !== 'console' || c.tenant !== tenant || c.deployment !== deployment || !String(c.scope || '').split(/\s+/).includes(scope)) throw createError({ statusCode: 403, statusMessage: 'hr_source_identity_invalid' })
}
export async function callHRSourceCommand(event: H3Event, kind: HRSourceKind, frozen: FrozenDirectoryCommand) {
  const route = resolveTrustedServiceAppRoute(event, 'console', { basePath: '/' })
  if (!route) throw createError({ statusCode: 503 })
  const tuple = hrSourceTargets[kind]
  const capability = `console:hr-source-sync:${tuple[0]}`
  if (frozen.sourceApp !== 'enterprise' || frozen.targetApp !== 'console' || frozen.operationCode !== tuple[1] || frozen.requiredCapability !== capability || frozen.commandSchemaVersion !== 'v1' || !frozen.command.actorUid || await hashServiceCommandPayload(frozen.command) !== frozen.commandSha256) throw createError({ statusCode: 403 })
  const path = hrSourcePath(kind, frozen.command)
  return requestWithServiceAccessToken({ event, audience: 'console', scope: capability, async request(token) {
    validateHRSourceClaims(token, capability, frozen.tenantCode, frozen.deploymentCode)
    const requestId = crypto.randomUUID()
    const envelope = { operationId: String(frozen.operationId), targetApp: 'console', operationCode: tuple[1], requiredCapability: capability, idempotencyKey: String(frozen.idempotencyKey), commandSchemaVersion: 'v1', commandSha256: String(frozen.commandSha256), command: frozen.command }
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: path, requestId, tenantCode: frozen.tenantCode, sourceDeploymentCode: frozen.deploymentCode, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'console', envelope })
    const result = await fetchConsoleServiceJson<{ code: number, data: Record<string, unknown> }>(event, `${route.origin}${path}`, { method: 'POST', timeout: 15_000, headers: { ...trustedServiceRequestHeaders(event, 'console'), ...signed, 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'idempotency-key': envelope.idempotencyKey }, body: { serviceCommand: envelope } })
    if (result.code !== 0 || !result.data || typeof result.data !== 'object') throw createError({ statusCode: 502, statusMessage: 'hr_source_confirmation_invalid' })
    return result.data
  } })
}
export async function readHRSource(event: H3Event, kind: 'mappings' | 'changes' | 'job', tenant: string, deployment: string, jobId = '') {
  const route = resolveTrustedServiceAppRoute(event, 'console', { basePath: '/' })
  if (!route) throw createError({ statusCode: 503 })
  if (kind === 'job' && !/^crj_[A-Za-z0-9_-]{20,64}$/.test(jobId)) throw createError({ statusCode: 400 })
  const path = kind === 'job' ? `/api/v1/console/service/connector-runtime/people-sync-jobs/${encodeURIComponent(jobId)}` : hrSourceTargets[kind][2]
  return requestWithServiceAccessToken({ event, audience: 'console', scope: 'console:hr-source-sync:view', async request(token) {
    validateHRSourceClaims(token, 'console:hr-source-sync:view', tenant, deployment)
    return fetchConsoleServiceJson<Record<string, unknown>>(event, `${route.origin}${path}`, { method: 'GET', timeout: 10_000, headers: { ...trustedServiceRequestHeaders(event, 'console'), authorization: `Bearer ${token}` } })
  } })
}
