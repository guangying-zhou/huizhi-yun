import { decodeJwt } from 'jose'
import { createError, type H3Event } from 'h3'
import { resolveTrustedServiceAppRoute } from './serviceAppUrl'
import { requestWithServiceAccessToken, fetchConsoleServiceJson, trustedServiceRequestHeaders } from './serviceOidc'
import { buildServiceCommandEnvelope, type ClaimedServiceCommand } from './serviceOperation'

export interface FrozenDirectoryCommand extends ClaimedServiceCommand {
  tenantCode: string
  deploymentCode: string
  sourceApp: 'enterprise'
  targetApp: 'console'
  operationKey: string
  command: Record<string, unknown>
}
const fixed = Object.freeze({
  'people.directory.identity-reserve.v1': ['console:directory-identity:reserve', '/api/v1/console/service/directory/onboarding/identity-reservations'],
  'people.directory.identity-release.v1': ['console:directory-identity:reserve', '/api/v1/console/service/directory/onboarding/identity-reservation-release'],
  'people.directory.user-provision.v1': ['console:directory-user:provision', '/api/v1/console/service/directory/onboarding/user-provision'],
  'people.directory.user-provision-status.v1': ['console:directory-user:provision', '/api/v1/console/service/directory/onboarding/operation-status'],
  'people.directory.activation-link.v1': ['console:directory-user:provision', '/api/v1/console/service/directory/onboarding/activation-link'],
  'people.directory.employment-sync.v1': ['console:directory-employment:sync', 'employment'],
  'people.directory.offboarding-disable.v1': ['console:directory-offboarding:disable', 'disable']
} as const)

// The historical Console Directory signature is a different wire protocol from
// Runtime's service-command HMAC. Keep its implementation in Foundation only.
export async function directoryCommandHeaders(token: string, path: string, operation: FrozenDirectoryCommand, targetDeployment: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const claims = decodeJwt(token)
  const hzy = claims.hzy as { appCode?: string, clientCode?: string } | undefined
  if (claims.token_use !== 'service' || claims.source_app !== 'enterprise' || hzy?.appCode !== 'enterprise' || claims.client_id !== 'enterprise.runtime' || hzy?.clientCode !== 'enterprise.runtime' || claims.target_app !== 'console' || claims.aud !== 'console' || claims.tenant !== operation.tenantCode || claims.deployment !== operation.deploymentCode || operation.sourceApp !== 'enterprise' || operation.targetApp !== 'console') throw createError({ statusCode: 403, statusMessage: 'directory_command_identity_invalid' })
  const pair = fixed[String(operation.operationCode) as keyof typeof fixed]
  if (!pair || pair[0] !== operation.requiredCapability || !String(claims.scope || '').split(/\s+/).includes(pair[0])) throw createError({ statusCode: 403 })
  const command = operation.command
  const expected = pair[1].startsWith('/') ? pair[1] : `/api/v1/console/service/directory/users/${encodeURIComponent(String(command.employeeUid || ''))}/${pair[1]}`
  if (path !== expected || !targetDeployment || !command.originalActorUid) throw createError({ statusCode: 403 })
  const message = `POST\n${path}\n${operation.tenantCode}\n${operation.deploymentCode}\n${targetDeployment}\nenterprise\nconsole\n${operation.operationId}\n${operation.operationCode}\n${operation.requiredCapability}\n${operation.idempotencyKey}\n${operation.commandSchemaVersion}\n${operation.commandSha256}\n${command.originalActorUid}\n${timestamp}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))), b => b.toString(16).padStart(2, '0')).join('')
  return { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': String(operation.idempotencyKey), 'x-hzy-tenant': operation.tenantCode, 'x-hzy-service-command-source-deployment': operation.deploymentCode, 'x-hzy-service-command-target-deployment': targetDeployment, 'x-hzy-service-command-timestamp': timestamp, 'x-hzy-service-command-signature': signature }
}
export async function callDirectoryServiceCommand(event: H3Event, operation: FrozenDirectoryCommand) {
  const route = resolveTrustedServiceAppRoute(event, 'console', { basePath: '/' })
  if (!route) throw createError({ statusCode: 503, statusMessage: 'directory_target_unavailable' })
  const pair = fixed[String(operation.operationCode) as keyof typeof fixed]
  if (!pair) throw createError({ statusCode: 403 })
  const path = pair[1].startsWith('/') ? pair[1] : `/api/v1/console/service/directory/users/${encodeURIComponent(String(operation.command.employeeUid || ''))}/${pair[1]}`
  return await requestWithServiceAccessToken({ event, audience: 'console', scope: pair[0], async request(token) {
    const headers = await directoryCommandHeaders(token, path, operation, route.deploymentCode)
    const body = buildServiceCommandEnvelope(operation)
    Object.assign(body.serviceCommand, { sourceApp: 'enterprise', sourceDeployment: operation.deploymentCode, targetDeployment: route.deploymentCode })
    const response = await fetchConsoleServiceJson<{ code: number, data: Record<string, unknown> }>(event, `${route.origin}${path}`, { method: 'POST', headers: { ...trustedServiceRequestHeaders(event, 'console'), 'x-forwarded-prefix': '/', ...headers }, body, timeout: 10_000 })
    if (String(response.code) !== '0' || !response.data || typeof response.data !== 'object') throw createError({ statusCode: 502, statusMessage: 'directory_target_response_invalid' })
    return response.data
  } })
}

export async function callDirectoryEmploymentStatus(event: H3Event, operation: FrozenDirectoryCommand) {
  const route = resolveTrustedServiceAppRoute(event, 'console', { basePath: '/' })
  if (!route) throw createError({ statusCode: 503 })
  return await requestWithServiceAccessToken({ event, audience: 'console', scope: 'console:directory-employment:sync', async request(token) {
    const probe = { ...operation, operationCode: 'people.directory.employment-sync.v1', requiredCapability: 'console:directory-employment:sync', command: { ...operation.command, employeeUid: operation.command.uid } }
    const path = `/api/v1/console/service/directory/users/${encodeURIComponent(String(operation.command.uid))}/employment`
    const headers = await directoryCommandHeaders(token, path, probe, route.deploymentCode)
    const response = await fetchConsoleServiceJson<{ code: number, data: Record<string, unknown> }>(event, `${route.origin}/api/v1/console/service/directory/onboarding/employment-status?uid=${encodeURIComponent(String(operation.command.uid))}`, { method: 'GET', headers: { ...trustedServiceRequestHeaders(event, 'console'), 'x-forwarded-prefix': '/', 'authorization': headers.authorization }, timeout: 10_000 })
    if (String(response.code) !== '0' || !response.data) throw createError({ statusCode: 502 })
    return response.data
  } })
}

// Input is obtained from the Runtime's signed, fixed recovery operation. It is
// never constructed from browser uid/revision/target status fields.
export async function callDirectoryLifecycleProbe(event: H3Event, operation: FrozenDirectoryCommand) {
  const pair = fixed[String(operation.operationCode) as keyof typeof fixed]
  const kind = operation.operationCode === 'people.directory.employment-sync.v1' ? 'employment' : operation.operationCode === 'people.directory.offboarding-disable.v1' ? 'offboarding' : null
  const command = operation.command
  if (!kind || !pair || pair[0] !== operation.requiredCapability || operation.sourceApp !== 'enterprise' || operation.targetApp !== 'console' || typeof command.employeeUid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/.test(command.employeeUid) || !Number.isSafeInteger(command.sourceRevision) || Number(command.sourceRevision) < 1 || typeof command.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(command.snapshotHash)) throw createError({ statusCode: 403 })
  const route = resolveTrustedServiceAppRoute(event, 'console', { basePath: '/' })
  if (!route) throw createError({ statusCode: 503 })
  return await requestWithServiceAccessToken({ event, audience: 'console', scope: pair[0], async request(token) {
    // Reuse exact source/client/tenant/deployment validation; no POST is sent.
    const path = `/api/v1/console/service/directory/users/${encodeURIComponent(command.employeeUid as string)}/${kind === 'employment' ? 'employment' : 'disable'}`
    const headers = await directoryCommandHeaders(token, path, operation, route.deploymentCode)
    const query = new URLSearchParams({ uid: String(command.employeeUid), revision: String(command.sourceRevision), hash: String(command.snapshotHash), kind })
    const response = await fetchConsoleServiceJson<{ code: number, data: Record<string, unknown> }>(event, `${route.origin}/api/v1/console/service/directory/onboarding/lifecycle-command-status?${query}`, { method: 'GET', headers: { ...trustedServiceRequestHeaders(event, 'console'), 'x-forwarded-prefix': '/', 'authorization': headers.authorization }, timeout: 10_000 })
    const data = response.data
    if (String(response.code) !== '0' || !data || data.lifecycleType !== kind || !['pending', 'succeeded', 'superseded'].includes(String(data.directoryStatus)) || !['unknown', 'pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter'].includes(String(data.platformStatus))) throw createError({ statusCode: 502 })
    return { lifecycleType: kind, directoryStatus: String(data.directoryStatus), platformStatus: String(data.platformStatus) }
  } })
}
