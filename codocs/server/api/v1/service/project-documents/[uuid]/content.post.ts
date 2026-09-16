/**
 * Read one Aims-bound project document through a signed service command.
 *
 * The Aims browser BFF has already proven its own project membership and
 * exact document binding. This endpoint does not trust that fact as a Codocs
 * grant: it only accepts the source-bound command, then asks Codocs runtime to
 * re-apply the document's owner/share/relation ACL for the signed actor.
 */
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { getHeader, getRequestURL, type H3Event } from 'h3'
import {
  hashServiceCommandPayload,
  verifyServiceCommandRuntimeHeaders
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { downloadDocument } from '~~/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import {
  AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH,
  requireCodocsServiceAuth,
  requireCodocsServiceTenantDeploymentBinding
} from '~~/server/utils/serviceAuthGuard'

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
    projectCode?: unknown
    documentUuid?: unknown
    action?: unknown
  }
}

type RuntimeContentGrant = {
  uuid?: string
  title?: string
  docType?: string
  contentSize?: number
  updatedAt?: string
  ossPath?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function invalidCommand(): never {
  throw createError({ statusCode: 403, message: 'Aims project document service command is invalid.' })
}

async function validateCommand(value: unknown, uuid: string): Promise<ServiceCommand> {
  const serviceCommand = value && typeof value === 'object' && !Array.isArray(value)
    ? value as ServiceCommand
    : null
  const command = serviceCommand?.command
  const commandSha256 = await hashServiceCommandPayload({
    actorUid: text(command?.actorUid),
    projectCode: text(command?.projectCode),
    documentUuid: text(command?.documentUuid),
    action: text(command?.action)
  })
  if (
    !serviceCommand
    || !command
    || text(serviceCommand.targetApp) !== 'codocs'
    || text(serviceCommand.operationCode) !== 'aims.codocs.project-document.content-read.v1'
    || text(serviceCommand.requiredCapability) !== 'codocs:project-document:content:read'
    || text(serviceCommand.commandSchemaVersion) !== 'aims.codocs.project-document.content.v1'
    || !text(serviceCommand.operationId)
    || !text(serviceCommand.idempotencyKey)
    || text(serviceCommand.commandSha256) !== commandSha256
    || !text(command.actorUid)
    || !text(command.projectCode)
    || text(command.documentUuid) !== uuid
    || text(command.action) !== 'content:read'
  ) invalidCommand()
  return serviceCommand
}

function serviceBearerToken(event: H3Event) {
  const authorization = text(getHeader(event, 'authorization'))
  const match = /^Bearer\s+(.+)$/iu.exec(authorization)
  if (!match?.[1]) {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  return match[1]
}

export default defineEventHandler(async (event) => {
  // Authenticate and bind tenant/deployment before reading request body or
  // touching tenant-runtime/OSS. This keeps a malformed body from probing a
  // tenant boundary and avoids the old wide-read confused-deputy path.
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH)
  requireCodocsServiceTenantDeploymentBinding(
    auth,
    getHeader(event, 'x-hzy-tenant'),
    getHeader(event, 'x-hzy-deployment')
  )

  const uuid = text(getRouterParam(event, 'uuid'))
  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }
  const body = await readBody<{ serviceCommand?: unknown }>(event)
  const serviceCommand = await validateCommand(body?.serviceCommand, uuid)
  const requestId = text(getHeader(event, 'x-request-id'))
  await verifyServiceCommandRuntimeHeaders({
    token: serviceBearerToken(event),
    method: 'POST',
    requestTarget: getRequestURL(event).pathname,
    requestId,
    tenantCode: text(auth.tenant),
    sourceDeploymentCode: text(auth.deployment),
    targetDeploymentCode: text(auth.deployment),
    sourceApp: 'aims',
    sourceClientId: 'aims.runtime',
    targetApp: 'codocs',
    envelope: {
      operationId: text(serviceCommand.operationId),
      targetApp: text(serviceCommand.targetApp),
      operationCode: text(serviceCommand.operationCode),
      requiredCapability: text(serviceCommand.requiredCapability),
      idempotencyKey: text(serviceCommand.idempotencyKey),
      commandSchemaVersion: text(serviceCommand.commandSchemaVersion),
      commandSha256: text(serviceCommand.commandSha256)
    },
    readHeader: name => getHeader(event, name)
  })
  let grant: RuntimeContentGrant
  try {
    grant = await callCodocsTenantRuntime<RuntimeContentGrant>(
      event,
      `/v1/codocs/service/project-documents/${encodeURIComponent(uuid)}/content`,
      {
        method: 'POST',
        scope: 'codocs.write',
        serviceTokenSourceBinding: 'service-client-policy',
        serviceCommandActor: { uid: text(serviceCommand.command?.actorUid) },
        body: { serviceCommand }
      }
    )
  } catch (error: unknown) {
    const runtimeError = error as {
      statusCode?: number
      status?: number
      message?: string
      data?: { code?: string, message?: string, upstreamStatus?: number }
    }
    console.error('[project-document-content] tenant runtime rejected:', {
      statusCode: runtimeError.statusCode || runtimeError.status || runtimeError.data?.upstreamStatus || 0,
      code: runtimeError.data?.code || '',
      message: runtimeError.data?.message || runtimeError.message || ''
    })
    throw error
  }
  if (!grant.ossPath || !grant.uuid || !grant.docType) {
    throw createError({ statusCode: 502, message: 'Codocs project document content grant is incomplete.' })
  }

  let content = ''
  try {
    content = (await downloadDocument(grant.ossPath, grant.docType)) || ''
    if (!hasMeaningfulMarkdownContent(content)) {
      content = await recoverMarkdownFromYjsSnapshot(grant.ossPath, grant.docType)
    }
  } catch (error: unknown) {
    console.error('[project-document-content] failed to read OSS:', (error as Error).message)
    throw createError({ statusCode: 500, message: '读取文档内容失败' })
  }

  // The public service response intentionally contains no storage path,
  // signature, permission decision, project grant or other internal context.
  return {
    code: 0,
    data: {
      uuid: grant.uuid,
      title: grant.title || '',
      docType: grant.docType,
      contentSize: Number(grant.contentSize || 0),
      content,
      updatedAt: grant.updatedAt || ''
    }
  }
})
