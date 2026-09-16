import { getHeader, getRequestURL, type H3Event } from 'h3'
import {
  hashServiceCommandPayload,
  verifyServiceCommandRuntimeHeaders
} from '@hzy/foundation/server/utils/tenantRuntimeClient'

export type AltocEntityDocumentAction = 'content:read' | 'attach:authorize'

type ServiceCommand = {
  operationId?: unknown
  targetApp?: unknown
  operationCode?: unknown
  requiredCapability?: unknown
  idempotencyKey?: unknown
  commandSchemaVersion?: unknown
  commandSha256?: unknown
  command?: {
    actorUid?: unknown
    entityType?: unknown
    entityId?: unknown
    documentUuid?: unknown
    action?: unknown
  }
}

function text(value: unknown) {
  return String(value || '').trim()
}

function integer(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function isAltocEntityType(value: unknown) {
  return new Set(['opportunity', 'contract', 'quotation', 'customer', 'lead', 'tender']).has(text(value))
}

function spec(action: AltocEntityDocumentAction) {
  return action === 'content:read'
    ? {
        operationCode: 'altoc.codocs.entity-document.content-read.v1',
        capability: 'codocs:altoc-entity-document:content:read',
        schema: 'altoc.codocs.entity-document.content.v1'
      }
    : {
        operationCode: 'altoc.codocs.entity-document.attach-authorize.v1',
        capability: 'codocs:altoc-entity-document:attach',
        schema: 'altoc.codocs.entity-document.attach.v1'
      }
}

function invalidCommand(): never {
  throw createError({ statusCode: 403, message: 'Altoc entity document service command is invalid.' })
}

export async function validateAltocEntityDocumentCommand(value: unknown, uuid: string, action: AltocEntityDocumentAction) {
  const serviceCommand = value && typeof value === 'object' && !Array.isArray(value)
    ? value as ServiceCommand
    : null
  const command = serviceCommand?.command
  const commandSha256 = await hashServiceCommandPayload({
    actorUid: text(command?.actorUid),
    entityType: text(command?.entityType),
    entityId: integer(command?.entityId),
    documentUuid: text(command?.documentUuid),
    action: text(command?.action)
  })
  const expected = spec(action)
  if (
    !serviceCommand || !command
    || text(serviceCommand.targetApp) !== 'codocs'
    || text(serviceCommand.operationCode) !== expected.operationCode
    || text(serviceCommand.requiredCapability) !== expected.capability
    || text(serviceCommand.commandSchemaVersion) !== expected.schema
    || !text(serviceCommand.operationId) || !text(serviceCommand.idempotencyKey)
    || text(serviceCommand.commandSha256) !== commandSha256
    || !text(command.actorUid) || !isAltocEntityType(command.entityType) || !integer(command.entityId)
    || text(command.documentUuid) !== uuid || text(command.action) !== action
  ) invalidCommand()
  return serviceCommand
}

function serviceBearerToken(event: H3Event) {
  const authorization = text(getHeader(event, 'authorization'))
  const match = /^Bearer\s+(.+)$/iu.exec(authorization)
  if (!match?.[1]) throw createError({ statusCode: 401, message: 'Console service token is required.' })
  return match[1]
}

export async function verifyAltocEntityDocumentCommandHeaders(input: {
  event: H3Event
  tenant: string
  deployment: string
  serviceCommand: Awaited<ReturnType<typeof validateAltocEntityDocumentCommand>>
}) {
  const requestId = text(getHeader(input.event, 'x-request-id'))
  await verifyServiceCommandRuntimeHeaders({
    token: serviceBearerToken(input.event),
    method: 'POST',
    requestTarget: getRequestURL(input.event).pathname,
    requestId,
    tenantCode: input.tenant,
    sourceDeploymentCode: input.deployment,
    targetDeploymentCode: input.deployment,
    sourceApp: 'altoc',
    sourceClientId: 'altoc',
    targetApp: 'codocs',
    envelope: {
      operationId: text(input.serviceCommand.operationId),
      targetApp: text(input.serviceCommand.targetApp),
      operationCode: text(input.serviceCommand.operationCode),
      requiredCapability: text(input.serviceCommand.requiredCapability),
      idempotencyKey: text(input.serviceCommand.idempotencyKey),
      commandSchemaVersion: text(input.serviceCommand.commandSchemaVersion),
      commandSha256: text(input.serviceCommand.commandSha256)
    },
    readHeader: name => getHeader(input.event, name)
  })
}
