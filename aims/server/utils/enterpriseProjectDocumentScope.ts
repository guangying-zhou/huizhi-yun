import { createError, type H3Event } from 'h3'
import { evaluateFoundationScopedAuthorization, type FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'
import type { SubjectScopedAuthorizationResult } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { resolveAimsProjectAuthorizationObject } from './aimsScopedAuthorization'

// The service command has already been authenticated and bound to actorUid.
// Evaluate its current project facts against that actor's own Console grants;
// neither the browser nor the service envelope can supply relationship facts.
export async function requireEnterpriseProjectDocumentWriteScope(event: H3Event, actorUid: string, projectId: string, subject: SubjectScopedAuthorizationResult) {
  if (subject.uid !== actorUid || subject.resourceCode !== 'projects' || subject.action !== 'edit') throw createError({ statusCode: 403, message: '项目文档授权上下文无效' })
  const object = await resolveAimsProjectAuthorizationObject(event, { projectId, uid: actorUid, requireCompleteFacts: true })
  if (!enterpriseProjectDocumentWriteScopeAllows(subject, object)) throw createError({ statusCode: 403, message: '无当前项目的文档编辑权限' })
}

export function enterpriseProjectDocumentWriteScopeAllows(subject: SubjectScopedAuthorizationResult, object: FoundationObjectContext) {
  const departmentCode = String(object.departmentCode || '').trim()
  // Console's index maps each ancestor to its descendants. Derive the current
  // project's ancestors; never accept a department tree from the command body.
  const departmentTree = departmentCode
    ? Object.entries(subject.departmentTree).filter(([, descendants]) => descendants.includes(departmentCode)).map(([ancestor]) => ancestor)
    : []
  const project = { ...object, departmentTree }
  return evaluateFoundationScopedAuthorization({
    grants: subject.grants,
    required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
    object: project,
    policyOf: () => subject.actionPolicy
  }).allowed
}
