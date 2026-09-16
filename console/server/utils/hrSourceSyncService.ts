import { createError, getHeader, getRequestURL, type H3Event } from 'h3'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveConsoleRuntimeBinding } from './consoleRuntimeBinding'
import { isCanonicalPeopleHRSourceClient } from './peopleHRSourceIdentity'
import type { VaultActor } from './vault'

type Row = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

function bearerToken(event: H3Event) {
  const authorization = text(getHeader(event, 'authorization'))
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
}

export async function verifyPeopleHRSourceServiceCommand(
  event: H3Event,
  actor: VaultActor,
  body: Row,
  expectedCapability: string,
  expectedOperationCode: string
) {
  const envelope = record(body.serviceCommand)
  const command = record(envelope.command)
  const binding = resolveConsoleRuntimeBinding(event)
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  const sourceApp = text(actor.appCode)
  const sourceClientId = text(actor.actorId)
  const sourceDeploymentCode = text(actor.deploymentCode)
  if (
    !isCanonicalPeopleHRSourceClient(actor)
    || text(actor.tenantCode) !== binding.tenantId
    || text(envelope.targetApp) !== 'console'
    || text(envelope.requiredCapability) !== expectedCapability
    || text(envelope.operationCode) !== expectedOperationCode
    || text(envelope.commandSchemaVersion) !== 'v1'
    || !text(command.actorUid)
  ) {
    throw createError({ statusCode: 403, message: 'People HR source service command binding is invalid.' })
  }
  if (await hashServiceCommandPayload(command) !== text(envelope.commandSha256)) {
    throw createError({ statusCode: 422, message: 'People HR source service command payload hash is invalid.' })
  }
  await verifyServiceCommandRuntimeHeaders({
    token: bearerToken(event),
    method: String(event.node.req.method || 'POST').toUpperCase() as 'POST',
    requestTarget: getRequestURL(event).pathname + getRequestURL(event).search,
    requestId,
    tenantCode: binding.tenantId,
    sourceDeploymentCode,
    targetDeploymentCode: binding.deploymentId,
    sourceApp,
    sourceClientId,
    targetApp: 'console',
    envelope: envelope as never,
    readHeader: name => getHeader(event, name)
  })
  return { envelope, command, actorUid: text(command.actorUid), idempotencyKey: text(envelope.idempotencyKey) }
}
