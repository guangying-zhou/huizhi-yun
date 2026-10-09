import { AIMS_PROJECT_DOCUMENT_REVIEW_CONTENT_SERVICE_AUTH } from '~~/server/utils/serviceAuthGuard'
import {
  callProjectDocumentQualityRuntime,
  readReviewVersionContent,
  requireProjectDocumentQualityCommand
} from '~~/server/utils/projectDocumentQualityService'

export default defineEventHandler(async (event) => {
  const documentUuid = String(getRouterParam(event, 'uuid') || '').trim()
  const versionId = String(getRouterParam(event, 'versionId') || '').trim()
  if (!documentUuid || !versionId) throw createError({ statusCode: 400, message: '文档版本参数不完整' })
  const { serviceCommand, command } = await requireProjectDocumentQualityCommand({
    event,
    requirement: AIMS_PROJECT_DOCUMENT_REVIEW_CONTENT_SERVICE_AUTH,
    expectedOperation: 'aims.codocs.project-document.review-content.v1',
    expectedCapability: 'codocs:project-document:review-content:read',
    expectedSchema: 'aims.codocs.project-document.review-content.v1',
    expectedAction: 'review-content:read',
    documentUuid,
    versionId
  })
  if (!command.submissionNo || !['qa', 'project_director'].includes(command.roleCode || '')) {
    throw createError({ statusCode: 403, message: 'Aims review role binding is invalid.' })
  }
  const grant = await callProjectDocumentQualityRuntime<Parameters<typeof readReviewVersionContent>[0]>(
    event,
    `/v1/codocs/service/project-documents/${encodeURIComponent(documentUuid)}/versions/${encodeURIComponent(versionId)}/review-content`,
    serviceCommand
  )
  return { code: 0, data: await readReviewVersionContent(grant) }
})
