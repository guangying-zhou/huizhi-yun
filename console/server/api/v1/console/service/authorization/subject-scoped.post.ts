import { createError, getQuery, readBody, setHeader } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { resolveSubjectScopedAuthorizationRequest } from '~~/server/utils/subjectScopedAuthorizationContract'
import { loadSubjectScopedAuthorization } from '~~/server/utils/subjectScopedAuthorization'
import { SubjectEligibilityError } from '~~/server/utils/subjectEligibilityContract'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const actor = await requireConsoleServiceActor(event, 'console', 'console:subject-authorization:read', { requireBoundTargetApp: true })
  const binding = resolveConsoleRuntimeBinding(event)
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'subject_scoped_query_forbidden' })
  try {
    const request = resolveSubjectScopedAuthorizationRequest(actor, binding, await readBody(event))
    return { code: 0, data: await loadSubjectScopedAuthorization(event, request) }
  } catch (error) {
    if (error instanceof SubjectEligibilityError) throw createError({ statusCode: error.statusCode, message: error.code })
    throw error
  }
})
