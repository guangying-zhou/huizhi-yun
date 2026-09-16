import { createError, readBody, setHeader } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
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
  const binding = resolveConsoleRuntimeBinding(event)
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
