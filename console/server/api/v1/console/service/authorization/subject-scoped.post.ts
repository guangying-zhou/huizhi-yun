import { createError, getQuery, readBody, setHeader } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { isTrustedTenantGatewayRequest, loadConsoleRuntimeMode } from '~~/server/utils/platformRuntime'
import { localAimsDocumentBinding } from '~~/server/utils/localAimsDocumentBinding'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { resolveSubjectScopedAuthorizationRequest } from '~~/server/utils/subjectScopedAuthorizationContract'
import { loadSubjectScopedAuthorization } from '~~/server/utils/subjectScopedAuthorization'
import { SubjectEligibilityError } from '~~/server/utils/subjectEligibilityContract'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const actor = await requireConsoleServiceActor(event, 'console', 'console:subject-authorization:read', { requireBoundTargetApp: true })
  const binding = localAimsDocumentBinding({
    binding: resolveConsoleRuntimeBinding(event),
    actorAppCode: actor.appCode,
    actorDeploymentCode: actor.deploymentCode,
    managed: loadConsoleRuntimeMode(event).activationMode === 'managed-cloud-multitenant',
    trustedGateway: isTrustedTenantGatewayRequest(event),
    localFacade: process.env.HZY0_LOCAL_CONSOLE_FACADE === 'true',
    localWorkflow: process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true',
    overrideDeployment: process.env.HZY_CONSOLE_LOCAL_AIMS_DEPLOYMENT
  })
  if (!binding) throw createError({ statusCode: 403, message: 'subject_scoped_binding_mismatch' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'subject_scoped_query_forbidden' })
  try {
    const request = resolveSubjectScopedAuthorizationRequest(actor, binding, await readBody(event))
    return { code: 0, data: await loadSubjectScopedAuthorization(event, request) }
  } catch (error) {
    if (error instanceof SubjectEligibilityError) throw createError({ statusCode: error.statusCode, message: error.code })
    throw error
  }
})
