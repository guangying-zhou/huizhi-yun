import type { ObjectContext } from '@hzy/authz-core'
import { normalizeNullableString } from './api.ts'

export function authorizationQueryValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim() || null
}

export function authorizationQueryBooleanValue(value: unknown, fallback = true) {
  const normalized = String(Array.isArray(value) ? value[0] : value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return !['0', 'false', 'no', 'off'].includes(normalized)
}

function authorizationQueryList(value: unknown) {
  const raw = authorizationQueryValue(value)
  if (!raw) return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

export function authorizationObjectContextFromQuery(
  query: Record<string, unknown>,
  uid: string
): ObjectContext | undefined {
  const ownerUid = normalizeNullableString(query.ownerUid)
  const departmentCode = normalizeNullableString(query.departmentCode)
  const departmentTree = authorizationQueryList(query.departmentTree)
  const projectCode = normalizeNullableString(query.projectCode)
  const projectMemberUids = authorizationQueryList(query.projectMemberUids)
  const customerOwnerUid = normalizeNullableString(query.customerOwnerUid)
  const customerTeamUids = authorizationQueryList(query.customerTeamUids)
  const assignedUid = normalizeNullableString(query.assignedUid)
  const assignedUids = authorizationQueryList(query.assignedUids)
  const matchedRelations = authorizationQueryList(query.matchedRelations)
  const environment = normalizeNullableString(query.environment)
  const deploymentEnvironment = normalizeNullableString(query.deploymentEnvironment)

  if (
    !ownerUid
    && !departmentCode
    && departmentTree.length === 0
    && !projectCode
    && projectMemberUids.length === 0
    && !customerOwnerUid
    && customerTeamUids.length === 0
    && !assignedUid
    && assignedUids.length === 0
    && matchedRelations.length === 0
    && !environment
    && !deploymentEnvironment
  ) {
    return undefined
  }

  return {
    actorUid: uid,
    ownerUid,
    departmentCode,
    departmentTree,
    projectCode,
    projectMemberUids,
    customerOwnerUid,
    customerTeamUids,
    assignedUid,
    assignedUids,
    matchedRelations,
    environment,
    deploymentEnvironment
  }
}
