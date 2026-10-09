import type { FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'

const stringValue = (v: unknown) => String(v || '').trim()
const numberValue = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null
const field = (record: Record<string, unknown>, ...keys: string[]) => keys.map(key => record[key]).find(v => v !== undefined && v !== null && stringValue(v) !== '')

// Pure projection of authoritative owning facts, shared with independent Aims.
export function projectAuthorizationObjectFromFacts(project: Record<string, unknown>, members: Record<string, unknown>[], uid: string, projectId: string): FoundationObjectContext {
  const projectMemberUids = members
    .filter(member => !stringValue(field(member, 'status')) || stringValue(field(member, 'status')) === 'active')
    .map(member => stringValue(field(member, 'uid', 'user_uid', 'userUid')))
    .filter(Boolean)

  const actorIsMember = projectMemberUids.includes(uid)
  const projectOwnerUid = stringValue(field(project, 'leader_uid', 'leaderUid', 'owner_uid', 'ownerUid'))
  const ownerUid = stringValue(field(project, 'created_by', 'createdBy')) || projectOwnerUid
  const matchedRelations = new Set<string>()
  if (actorIsMember) {
    matchedRelations.add('project:member')
    matchedRelations.add('relation:project_member')
  }
  if (projectOwnerUid && projectOwnerUid === uid) {
    matchedRelations.add('project:owner')
    matchedRelations.add('project:manager')
    matchedRelations.add('relation:project_owner')
    matchedRelations.add('relation:project_manager')
  }

  return {
    actorUid: uid,
    ownerUid,
    projectOwnerUid,
    projectCode: stringValue(field(project, 'project_code', 'projectCode')) || projectId,
    departmentCode: stringValue(field(project, 'dept_code', 'deptCode')) || null,
    projectMemberUids,
    matchedRelations: [...matchedRelations],
    projectId: numberValue(field(project, 'id')) || numberValue(projectId) || projectId
  }
}
