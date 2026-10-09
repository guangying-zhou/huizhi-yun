import { createError, getHeader, getMethod, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { requireConsoleAuthContext } from './consoleOidc'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from './tenantRuntimeClient'
import { assertKnowledgeIdentity, canonicalKnowledgeCommand, knowledgeLinkCapability } from './knowledgeLinkContract'

export async function requireEnterpriseKnowledgeLink(event: H3Event, target: 'assets' | 'codocs') {
  const auth = await requireConsoleAuthContext(event)
  const gateway = resolveTrustedTenantGatewayContext(event)
  assertKnowledgeIdentity(auth, gateway, target)
  if (getMethod(event) !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = canonicalKnowledgeCommand(envelope?.command)
  if (!body || Object.keys(body).length !== 1 || !envelope || !command || command.targetDeployment !== gateway!.deployment || envelope.targetApp !== target || envelope.operationCode !== `enterprise.${target}.knowledge-link.v1` || envelope.commandSchemaVersion !== 'v1' || envelope.requiredCapability !== knowledgeLinkCapability(target) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '知识关联命令无效' })
  envelope.command = command
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401 })
  await verifyServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant!, sourceDeploymentCode: auth.deployment!, targetDeploymentCode: gateway!.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: target, envelope, readHeader: name => getHeader(event, name) })
  return { envelope, command }
}
