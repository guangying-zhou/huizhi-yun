import { AIMS_PROJECT_DOCUMENT_VERSION_RESOLVE_SERVICE_AUTH } from '~~/server/utils/serviceAuthGuard'
import {
  callProjectDocumentQualityRuntime,
  requireProjectDocumentQualityCommand
} from '~~/server/utils/projectDocumentQualityService'

export default defineEventHandler(async (event) => {
  const documentUuid = String(getRouterParam(event, 'uuid') || '').trim()
  const versionId = String(getRouterParam(event, 'versionId') || '').trim()
  if (!documentUuid || !versionId) throw createError({ statusCode: 400, message: '文档版本参数不完整' })
  const { serviceCommand } = await requireProjectDocumentQualityCommand({
    event,
    requirement: AIMS_PROJECT_DOCUMENT_VERSION_RESOLVE_SERVICE_AUTH,
    expectedOperation: 'aims.codocs.project-document.version-resolve.v1',
    expectedCapability: 'codocs:project-document:version:resolve',
    expectedSchema: 'aims.codocs.project-document.version.resolve.v1',
    expectedAction: 'version:resolve',
    documentUuid,
    versionId
  })
  const data = await callProjectDocumentQualityRuntime(
    event,
    `/v1/codocs/service/project-documents/${encodeURIComponent(documentUuid)}/versions/${encodeURIComponent(versionId)}:resolve`,
    serviceCommand
  )
  return { code: 0, data }
})
