import { AIMS_PROJECT_DOCUMENT_REVIEW_GRANT_SERVICE_AUTH } from '~~/server/utils/serviceAuthGuard'
import {
  callProjectDocumentQualityRuntime,
  requireProjectDocumentQualityCommand
} from '~~/server/utils/projectDocumentQualityService'

export default defineEventHandler(async (event) => {
  const { serviceCommand, command } = await requireProjectDocumentQualityCommand({
    event,
    requirement: AIMS_PROJECT_DOCUMENT_REVIEW_GRANT_SERVICE_AUTH,
    expectedOperation: 'aims.codocs.deliverable-review-grant.v1',
    expectedCapability: 'codocs:project-document:review-grant:create',
    expectedSchema: 'aims.codocs.project-document.review-grant.v1',
    expectedAction: 'review-grant:create'
  })
  if (!command.submissionNo || !['qa', 'project_director'].includes(command.granteeRoleCode || '')) {
    throw createError({ statusCode: 400, message: 'Aims review grant binding is incomplete.' })
  }
  const data = await callProjectDocumentQualityRuntime(
    event,
    '/v1/codocs/service/project-document-review-grants',
    serviceCommand
  )
  return { code: 0, data }
})
