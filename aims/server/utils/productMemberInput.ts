import { hasProductControlCharacter } from './productWorkspaceInput.ts'

export type MemberMutation = 'create' | 'update' | 'revoke'
const positiveInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const uidValid = (value: unknown): value is string => typeof value === 'string' && !!value && value === value.trim() && [...value].length <= 64 && !value.includes(',') && !hasProductControlCharacter(value)
function utcDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number(value.slice(0, 4)) < 1000) return false
  const date = new Date(value)
  return Number.isFinite(date.valueOf()) && date.toISOString() === value
}

export function memberChangeInput(action: MemberMutation, raw: unknown, id: number, actorUid: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const fields = ['uid', 'expectedRevision', 'expectedMemberRevision', 'continuingManagerUid', 'reason',
    ...(action === 'revoke' ? [] : ['relationType', 'status', 'validFrom', 'validUntil'])]
  if (Object.keys(input).some(key => !fields.includes(key)) || !uidValid(input.uid)
    || !positiveInteger(input.expectedRevision) || typeof input.reason !== 'string' || !input.reason.trim() || [...input.reason].length > 2000) return null
  if (action === 'create'
    ? id !== 0 || (input.expectedMemberRevision !== undefined && input.expectedMemberRevision !== 0)
    : !positiveInteger(id) || !positiveInteger(input.expectedMemberRevision)) return null
  if (action !== 'revoke' && (typeof input.relationType !== 'string' || !['manager', 'contributor', 'viewer'].includes(input.relationType)
    || typeof input.status !== 'string' || !['active', 'inactive'].includes(input.status) || !utcDate(input.validFrom)
    || (input.validUntil !== null && (!utcDate(input.validUntil) || input.validUntil <= input.validFrom)))) return null
  const continuingManager = input.continuingManagerUid ?? (action !== 'revoke' && input.relationType === 'manager' && input.status === 'active' ? input.uid : actorUid)
  if (!uidValid(continuingManager)) return null
  return {
    member_id: id, uid: input.uid, expected_revision: Number(input.expectedRevision),
    expected_member_revision: action === 'create' ? 0 : Number(input.expectedMemberRevision),
    relation_type: action === 'revoke' ? '' : String(input.relationType),
    status: action === 'revoke' ? 'inactive' : String(input.status),
    valid_from: action === 'revoke' ? '' : String(input.validFrom),
    valid_until: action === 'revoke' || input.validUntil === null ? null : String(input.validUntil),
    continuing_manager_uid: continuingManager, reason: input.reason
  }
}

export function memberPageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'relationType', 'status'].includes(key))) return null
  const number = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  const page = number(raw.page, 1), pageSize = number(raw.pageSize, 20)
  const relation = raw.relationType ?? '', status = raw.status ?? ''
  if (!positiveInteger(page) || page > 1000000 || !positiveInteger(pageSize) || pageSize > 100
    || typeof relation !== 'string' || !['', 'manager', 'contributor', 'viewer'].includes(relation)
    || typeof status !== 'string' || !['', 'active', 'inactive'].includes(status)) return null
  return { page, page_size: pageSize, relation_type: relation, status }
}
