import { createHash } from 'node:crypto'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import {
  hashServiceCommandPayload,
  verifyServiceCommandRuntimeHeaders
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getHeader, getRequestURL, type H3Event } from 'h3'
import { callCodocsTenantRuntime } from './codocsRuntime'
import {
  requireCodocsServiceAuth,
  requireCodocsServiceTenantDeploymentBinding,
  type CodocsServiceAuthRequirement
} from './serviceAuthGuard'
import { createOSSClient, createProjectsOSSClient } from './oss'

export type ProjectDocumentQualityCommand = {
  actorUid: string
  documentUuid: string
  versionId: string
  action: string
  projectCode?: string
  submissionNo?: string
  roleCode?: string
  granteeRoleCode?: string
}

type ServiceCommandEnvelope = {
  operationId: string
  targetApp: string
  operationCode: string
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  commandSha256: string
  command: ProjectDocumentQualityCommand
}

type RuntimeReviewContentGrant = {
  documentUuid: string
  versionId: number
  versionNum: number
  title: string
  docType: string
  ossPath: string
  ossVersionId: string
  contentSize: number
  contentSha256: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function bearerToken(event: H3Event) {
  const match = /^Bearer\s+(.+)$/iu.exec(text(getHeader(event, 'authorization')))
  if (!match?.[1]) throw createError({ statusCode: 401, message: 'Console service token is required.' })
  return match[1]
}

function normalizeCommand(value: unknown): ProjectDocumentQualityCommand {
  const command = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    actorUid: text(command.actorUid),
    documentUuid: text(command.documentUuid),
    versionId: text(command.versionId),
    action: text(command.action),
    projectCode: text(command.projectCode) || undefined,
    submissionNo: text(command.submissionNo) || undefined,
    roleCode: text(command.roleCode) || undefined,
    granteeRoleCode: text(command.granteeRoleCode) || undefined
  }
}

export async function requireProjectDocumentQualityCommand(params: {
  event: H3Event
  requirement: CodocsServiceAuthRequirement
  expectedOperation: string
  expectedCapability: string
  expectedSchema: string
  expectedAction: string
  documentUuid?: string
  versionId?: string
}) {
  const auth = await requireConsoleAuthContext(params.event)
  requireCodocsServiceAuth(auth, params.requirement)
  const binding = requireCodocsServiceTenantDeploymentBinding(
    auth,
    getHeader(params.event, 'x-hzy-tenant'),
    getHeader(params.event, 'x-hzy-deployment')
  )
  const body = await readBody<{ serviceCommand?: unknown }>(params.event)
  const rawEnvelope = body?.serviceCommand && typeof body.serviceCommand === 'object' && !Array.isArray(body.serviceCommand)
    ? body.serviceCommand as Record<string, unknown>
    : {}
  const command = normalizeCommand(rawEnvelope.command)
  const commandSha256 = await hashServiceCommandPayload(command)
  const envelope: ServiceCommandEnvelope = {
    operationId: text(rawEnvelope.operationId),
    targetApp: text(rawEnvelope.targetApp),
    operationCode: text(rawEnvelope.operationCode),
    requiredCapability: text(rawEnvelope.requiredCapability),
    idempotencyKey: text(rawEnvelope.idempotencyKey),
    commandSchemaVersion: text(rawEnvelope.commandSchemaVersion),
    commandSha256: text(rawEnvelope.commandSha256),
    command
  }
  const invalid = !envelope.operationId
    || envelope.targetApp !== 'codocs'
    || envelope.operationCode !== params.expectedOperation
    || envelope.requiredCapability !== params.expectedCapability
    || !envelope.idempotencyKey
    || envelope.commandSchemaVersion !== params.expectedSchema
    || envelope.commandSha256 !== commandSha256
    || !command.actorUid
    || !command.documentUuid
    || !command.versionId
    || command.action !== params.expectedAction
    || (params.documentUuid !== undefined && command.documentUuid !== params.documentUuid)
    || (params.versionId !== undefined && command.versionId !== params.versionId)
  if (invalid) throw createError({ statusCode: 403, message: 'Aims project document quality command is invalid.' })

  const requestId = text(getHeader(params.event, 'x-request-id'))
  await verifyServiceCommandRuntimeHeaders({
    token: bearerToken(params.event),
    method: 'POST',
    requestTarget: getRequestURL(params.event).pathname,
    requestId,
    tenantCode: binding.tenant,
    sourceDeploymentCode: binding.deployment,
    targetDeploymentCode: binding.deployment,
    sourceApp: 'aims',
    sourceClientId: 'aims.runtime',
    targetApp: 'codocs',
    envelope,
    readHeader: name => getHeader(params.event, name)
  })
  return { serviceCommand: envelope, command }
}

export async function callProjectDocumentQualityRuntime<T>(
  event: H3Event,
  path: string,
  serviceCommand: ServiceCommandEnvelope
) {
  return await callCodocsTenantRuntime<T>(event, path, {
    method: 'POST',
    scope: 'codocs.write',
    serviceTokenSourceBinding: 'service-client-policy',
    serviceCommandActor: { uid: serviceCommand.command.actorUid },
    body: { serviceCommand }
  })
}

export async function readReviewVersionContent(grant: RuntimeReviewContentGrant) {
  if (!grant.ossPath || !grant.ossVersionId || !grant.contentSha256) {
    throw createError({ statusCode: 502, message: 'Codocs deterministic review version grant is incomplete.' })
  }
  const client = grant.docType === 'git-project' ? createProjectsOSSClient() : createOSSClient()
  const result = await client.get(grant.ossPath, { versionId: grant.ossVersionId })
  const content = result.content.toString('utf8')
  const actualHash = createHash('sha256').update(content, 'utf8').digest('hex')
  if (actualHash !== grant.contentSha256) {
    throw createError({ statusCode: 409, message: 'Document version content hash does not match the review grant.' })
  }
  return {
    documentUuid: grant.documentUuid,
    versionId: grant.versionId,
    versionNum: grant.versionNum,
    title: grant.title,
    contentSize: grant.contentSize,
    contentSha256: grant.contentSha256,
    content
  }
}
