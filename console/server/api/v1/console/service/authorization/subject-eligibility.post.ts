import { createError, readBody, setHeader } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { isTrustedTenantGatewayRequest, loadConsoleRuntimeMode } from '~~/server/utils/platformRuntime'
import { localWorkflowEligibilityBinding } from '~~/server/utils/localWorkflowEligibilityBinding'
import { evaluateSubjectEligibility } from '~~/server/utils/subjectEligibility'
import {
  parseSubjectEligibilityRequest,
  resolveBoundSubjectEligibilityRequest,
  SubjectEligibilityError
} from '~~/server/utils/subjectEligibilityContract'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(
    event,
    'console',
    'console:authorization:subject-eligibility',
    { requireBoundTargetApp: true }
  )
  const binding = localWorkflowEligibilityBinding({
    binding: resolveConsoleRuntimeBinding(event),
    actorAppCode: actor.appCode,
    actorDeploymentCode: actor.deploymentCode,
    managed: loadConsoleRuntimeMode(event).activationMode === 'managed-cloud-multitenant',
    trustedGateway: isTrustedTenantGatewayRequest(event),
    localFacade: process.env.HZY0_LOCAL_CONSOLE_FACADE === 'true',
    localWorkflow: process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true',
    overrideDeployment: process.env.HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT
  })
  if (!binding) throw createError({ statusCode: 403, message: 'subject_eligibility_runtime_binding_mismatch' })
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const request = resolveBoundSubjectEligibilityRequest(
      actor,
      binding,
      parseSubjectEligibilityRequest(await readBody(event))
    )
    return await evaluateSubjectEligibility(event, binding, request)
  } catch (error) {
    if (error instanceof SubjectEligibilityError) {
      throw createError({ statusCode: error.statusCode, message: error.code })
    }
    throw error
  }
})
