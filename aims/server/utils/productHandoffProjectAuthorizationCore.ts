import type { FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'

export interface ProductHandoffProjectFacts {
  project_id: number
  project_code: string
  actor_uid: string
  department_code: string
  leader_uid: string
  created_by: string
  is_member: boolean
}

// Mirrors the existing Aims project authorization context, without falling
// back to a route ID or empty object when runtime facts are unavailable.
export function productHandoffProjectObject(facts: ProductHandoffProjectFacts, projectCode: string, uid: string): FoundationObjectContext | null {
  if (!uid || !projectCode || !facts || facts.actor_uid !== uid || facts.project_code !== projectCode
    || !Number.isSafeInteger(facts.project_id) || facts.project_id < 1 || typeof facts.is_member !== 'boolean'
    || [facts.department_code, facts.leader_uid, facts.created_by].some(value => typeof value !== 'string')) return null
  const isLeader = facts.leader_uid === uid
  return {
    actorUid: uid,
    projectId: facts.project_id,
    projectCode,
    departmentCode: facts.department_code || null,
    ownerUid: facts.created_by || facts.leader_uid || null,
    projectOwnerUid: facts.leader_uid || null,
    projectMemberUids: facts.is_member ? [uid] : [],
    matchedRelations: [
      ...(facts.is_member ? ['project:member', 'relation:project_member'] : []),
      ...(isLeader ? ['project:owner', 'project:manager', 'relation:project_owner', 'relation:project_manager'] : [])
    ]
  }
}
