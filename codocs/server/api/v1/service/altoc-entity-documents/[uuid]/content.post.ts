import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { getHeader } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { downloadDocument } from '~~/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import {
  ALTOC_ENTITY_DOCUMENT_CONTENT_SERVICE_AUTH,
  requireCodocsServiceAuth,
  requireCodocsServiceTenantDeploymentBinding
} from '~~/server/utils/serviceAuthGuard'
import {
  validateAltocEntityDocumentCommand,
  verifyAltocEntityDocumentCommandHeaders
} from '~~/server/utils/altocEntityDocumentService'

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

export default defineEventHandler(async (event) => {
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, ALTOC_ENTITY_DOCUMENT_CONTENT_SERVICE_AUTH)
  const binding = requireCodocsServiceTenantDeploymentBinding(auth, getHeader(event, 'x-hzy-tenant'), getHeader(event, 'x-hzy-deployment'))
  const uuid = text(getRouterParam(event, 'uuid'))
  if (!uuid) throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  const body = await readBody<{ serviceCommand?: unknown }>(event)
  const serviceCommand = await validateAltocEntityDocumentCommand(body?.serviceCommand, uuid, 'content:read')
  await verifyAltocEntityDocumentCommandHeaders({ event, ...binding, serviceCommand })
  const grant = await callCodocsTenantRuntime<RuntimeContentGrant>(event, `/v1/codocs/service/altoc-entity-documents/${encodeURIComponent(uuid)}/content`, {
    method: 'POST', scope: 'codocs.write', body: { serviceCommand }
  })
  if (!grant.ossPath || !grant.uuid || !grant.docType) throw createError({ statusCode: 502, message: 'Codocs entity document content grant is incomplete.' })
  let content = ''
  try {
    content = (await downloadDocument(grant.ossPath, grant.docType)) || ''
    if (!hasMeaningfulMarkdownContent(content)) content = await recoverMarkdownFromYjsSnapshot(grant.ossPath, grant.docType)
  } catch (error: unknown) {
    console.error('[altoc-entity-document-content] failed to read OSS:', (error as Error).message)
    throw createError({ statusCode: 500, message: '读取文档内容失败' })
  }
  return { code: 0, data: { uuid: grant.uuid, title: grant.title || '', docType: grant.docType, contentSize: Number(grant.contentSize || 0), content, updatedAt: grant.updatedAt || '' } }
})
