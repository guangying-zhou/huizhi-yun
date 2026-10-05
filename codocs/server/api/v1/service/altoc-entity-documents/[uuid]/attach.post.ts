import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { getHeader } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import {
  ALTOC_ENTITY_DOCUMENT_ATTACH_SERVICE_AUTH,
  requireCodocsServiceAuth,
  requireCodocsServiceTenantDeploymentBinding
} from '~~/server/utils/serviceAuthGuard'
import {
  validateAltocEntityDocumentCommand,
  verifyAltocEntityDocumentCommandHeaders
} from '~~/server/utils/altocEntityDocumentService'

type RuntimeAttachGrant = { uuid?: string, title?: string, docType?: string }
function text(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, ALTOC_ENTITY_DOCUMENT_ATTACH_SERVICE_AUTH)
  const binding = requireCodocsServiceTenantDeploymentBinding(auth, getHeader(event, 'x-hzy-tenant'), getHeader(event, 'x-hzy-deployment'))
  const uuid = text(getRouterParam(event, 'uuid'))
  if (!uuid) throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  const body = await readBody<{ serviceCommand?: unknown }>(event)
  const serviceCommand = await validateAltocEntityDocumentCommand(body?.serviceCommand, uuid, 'attach:authorize')
  await verifyAltocEntityDocumentCommandHeaders({ event, ...binding, serviceCommand })
  const grant = await callCodocsTenantRuntime<RuntimeAttachGrant>(event, `/v1/codocs/service/altoc-entity-documents/${encodeURIComponent(uuid)}/attach`, {
    method: 'POST', scope: 'codocs.write', body: { serviceCommand }
  })
  if (!grant.uuid) throw createError({ statusCode: 502, message: 'Codocs entity document attach grant is incomplete.' })
  return { code: 0, data: { uuid: grant.uuid, title: grant.title || '', docType: grant.docType || '' } }
})
