import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import {
  hashServiceCommandPayload,
  verifyServiceCommandRuntimeHeaders
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getHeader, getRequestURL, type H3Event } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'
import {
  AIMS_DEPARTMENT_DOCUMENTS_LIST_SERVICE_AUTH,
  requireCodocsServiceAuth
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
    deptCode?: unknown
    pageSize?: unknown
    action?: unknown
  }
}

type RuntimeDepartmentDocuments = {
  deptCode?: string
  folders?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
}

function text(value: unknown) {
  return String(value || '').trim()
}

function integer(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : 0
}

function invalidCommand(): never {
  throw createError({ statusCode: 403, message: 'Aims department document service command is invalid.' })
}

async function validateCommand(value: unknown) {
  const serviceCommand = value && typeof value === 'object' && !Array.isArray(value)
    ? value as ServiceCommand
    : null
  const command = serviceCommand?.command
  const normalized = {
    actorUid: text(command?.actorUid),
    deptCode: text(command?.deptCode),
    pageSize: integer(command?.pageSize),
    action: text(command?.action)
  }
  const commandSha256 = await hashServiceCommandPayload(normalized)
  if (
    !serviceCommand
    || !command
    || text(serviceCommand.targetApp) !== 'codocs'
    || text(serviceCommand.operationCode) !== 'aims.codocs.department-documents.list.v1'
    || text(serviceCommand.requiredCapability) !== 'codocs:department-documents:list'
    || text(serviceCommand.commandSchemaVersion) !== 'aims.codocs.department-documents.list.v1'
    || !text(serviceCommand.operationId)
    || !text(serviceCommand.idempotencyKey)
    || text(serviceCommand.commandSha256) !== commandSha256
    || !normalized.actorUid
    || !normalized.deptCode
    || normalized.pageSize < 1
    || normalized.pageSize > 200
    || normalized.action !== 'list'
  ) invalidCommand()
  return { serviceCommand, ...normalized }
}

function serviceBearerToken(event: H3Event) {
  const authorization = text(getHeader(event, 'authorization'))
  const match = /^Bearer\s+(.+)$/iu.exec(authorization)
  if (!match?.[1]) {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  return match[1]
}

function nullableText(value: unknown) {
  const normalized = text(value)
  return normalized || null
}

export default defineEventHandler(async (event) => {
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_DEPARTMENT_DOCUMENTS_LIST_SERVICE_AUTH)
  const tenantCode = text(auth.tenant)
  const sourceDeploymentCode = text(auth.deployment)
  const requestTenantCode = text(getHeader(event, 'x-hzy-tenant'))
  const targetAppCode = text(getHeader(event, 'x-hzy-app-code'))
  const targetDeploymentCode = text(getHeader(event, 'x-hzy-deployment'))
  const signedSourceDeploymentCode = text(getHeader(event, 'x-hzy-service-command-source-deployment'))
  const signedTargetDeploymentCode = text(getHeader(event, 'x-hzy-service-command-target-deployment'))
  if (
    !tenantCode
    || tenantCode !== requestTenantCode
    || !sourceDeploymentCode
    || sourceDeploymentCode !== signedSourceDeploymentCode
    || targetAppCode !== 'codocs'
    || !targetDeploymentCode
    || targetDeploymentCode !== `${tenantCode}-codocs`
    || targetDeploymentCode !== signedTargetDeploymentCode
  ) {
    throw createError({ statusCode: 403, message: 'Aims department document source/target deployment binding is invalid.' })
  }

  const body = await readBody<{ serviceCommand?: unknown }>(event)
  const { serviceCommand, actorUid, deptCode } = await validateCommand(body?.serviceCommand)
  const requestId = text(getHeader(event, 'x-request-id'))
  await verifyServiceCommandRuntimeHeaders({
    token: serviceBearerToken(event),
    method: 'POST',
    requestTarget: getRequestURL(event).pathname,
    requestId,
    tenantCode,
    sourceDeploymentCode,
    targetDeploymentCode,
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

  // Target-domain verification is deliberate: Aims' department check is a
  // caller-side narrowing guard, not a substitute for Codocs authorization.
  await requireDepartmentReadAccess(event, actorUid, deptCode)

  const runtime = await callCodocsTenantRuntime<RuntimeDepartmentDocuments>(
    event,
    '/v1/codocs/service/department-documents/search',
    {
      method: 'POST',
      scope: 'codocs.write',
      serviceTokenSourceBinding: 'service-client-policy',
      serviceCommandActor: { uid: actorUid },
      body: { serviceCommand }
    }
  )

  return {
    code: 0,
    data: {
      folders: (runtime.folders || []).map(folder => ({
        id: integer(folder.id),
        name: text(folder.name),
        folder_type: text(folder.folder_type),
        owner_uid: text(folder.owner_uid),
        dept_code: nullableText(folder.dept_code),
        project_code: nullableText(folder.project_code),
        parent_id: integer(folder.parent_id) || null,
        sort_order: integer(folder.sort_order),
        created_at: text(folder.created_at),
        updated_at: text(folder.updated_at)
      })),
      items: (runtime.items || []).map(item => ({
        uuid: text(item.uuid),
        title: text(item.title),
        docType: text(item.doc_type),
        ownerUid: text(item.owner_uid),
        deptCode: nullableText(item.dept_code),
        projectCode: nullableText(item.project_code),
        folderId: integer(item.folder_id) || null,
        folderName: nullableText(item.folder_name),
        contentSize: integer(item.content_size),
        aiAbstract: nullableText(item.ai_abstract),
        updatedAt: text(item.updated_at)
      }))
    }
  }
})
