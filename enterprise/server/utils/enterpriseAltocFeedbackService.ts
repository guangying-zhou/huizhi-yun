import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAltocServiceAuth } from '@hzy/foundation/server/utils/consoleOidc'
import { callEnterpriseAltocFeedbackProjection } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'

export async function enterpriseAltocFeedbackService(event: H3Event, kind: 'status' | 'progress') {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const auth = await requireConsoleAltocServiceAuth(event)
  const gateway = resolveTrustedTenantGatewayContext(event)
  const source = resolveTrustedServiceAppRoute(event, 'aims')
  const target = resolveTrustedServiceAppRoute(event, 'altoc')
  const physical = resolveTrustedServiceAppRoute(event, gateway?.appCode === 'enterprise' ? 'enterprise' : 'altoc')
  const scope = `altoc:product-feedback:update-${kind}`
  if (auth.appCode !== 'aims' || auth.clientCode !== 'aims.runtime' || !auth.scopes?.includes(scope) || !gateway || !['enterprise', 'altoc'].includes(gateway.appCode) || gateway.tenant !== auth.tenant || !source || source.deploymentCode !== auth.deployment || !target || !physical || gateway.deployment !== physical.deploymentCode) throw createError({ statusCode: 403 })
  const body = await readBody<{ serviceCommand?: Parameters<typeof verifyServiceCommandRuntimeHeaders>[0]['envelope'] }>(event)
  const env = body?.serviceCommand
  const command = env?.command
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !env || typeof env !== 'object' || Array.isArray(env) || !command || Array.isArray(command) || typeof command !== 'object' || env.targetApp !== 'altoc' || env.requiredCapability !== scope || env.operationCode !== `aims.altoc.product-feedback.update-${kind}.v1` || env.commandSchemaVersion !== `product-feedback-${kind}.v1` || env.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403 })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401 })
  await verifyServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant!, sourceDeploymentCode: auth.deployment!, targetDeploymentCode: target.deploymentCode, sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'altoc', envelope: env, readHeader: name => getHeader(event, name) })
  const result = await callEnterpriseAltocFeedbackProjection<{ code: number, data: Record<string, unknown> }>(event, kind, {
    TrustedContext: { TenantCode: auth.tenant, DeploymentCode: auth.deployment, SourceApp: 'aims', ServiceClientID: 'aims.runtime', RequestID: getHeader(event, 'x-request-id') || '' },
    SourceDeploymentCode: auth.deployment, TargetDeploymentCode: target.deploymentCode, TargetApp: 'altoc', OperationID: env.operationId, OperationCode: env.operationCode, RequiredCapability: scope, IdempotencyKey: env.idempotencyKey, CommandSchemaVersion: env.commandSchemaVersion, CommandSHA256: env.commandSha256, Command: command
  })
  if (result.code !== 0 || !result.data || result.data.receiptStatus !== 'succeeded' || result.data.operationId !== env.operationId || result.data.commandSha256 !== env.commandSha256) throw createError({ statusCode: 503 })
  return result
}
