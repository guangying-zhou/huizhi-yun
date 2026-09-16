export const CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY = 'codocs_trusted_department_read_dept_code'
export const CODOCS_TRUSTED_DEPARTMENT_MANAGE_QUERY_KEY = 'codocs_trusted_department_manage_dept_code'

const UNTRUSTED_DOCUMENT_READ_CONTEXT_KEYS = [
  'current_user',
  'currentUser',
  'operator_uid',
  'operatorUid',
  'actor_uid',
  'actorUid',
  CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY,
  CODOCS_TRUSTED_DEPARTMENT_MANAGE_QUERY_KEY
]

/**
 * Rebuilds document-list query context after the BFF has authenticated the
 * browser session. Caller-provided actor and department-trust fields are never
 * forwarded; `owner` and other ordinary filters remain narrowing predicates.
 */
export function withTrustedCodocsDocumentReadContext(
  source: Record<string, unknown>,
  actorUid: string,
  trustedDepartmentReadDeptCode = ''
) {
  const actor = String(actorUid || '').trim()
  if (!actor) throw new Error('trusted document read actor is required')

  const result: Record<string, unknown> = { ...source }
  for (const key of UNTRUSTED_DOCUMENT_READ_CONTEXT_KEYS) Reflect.deleteProperty(result, key)

  result.current_user = actor
  result.currentUser = actor
  result.operator_uid = actor
  result.operatorUid = actor
  result.actor_uid = actor
  result.actorUid = actor

  const trustedDepartment = String(trustedDepartmentReadDeptCode || '').trim()
  if (trustedDepartment) {
    result[CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY] = trustedDepartment
  }
  return result
}
