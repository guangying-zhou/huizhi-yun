export type AimsDueStream = 'response_due' | 'resolution_due' | 'work_item_due'

export interface AimsDueCandidate {
  stream: AimsDueStream
  phase: 'T-4h' | 'T-1h' | 'breached' | 'D3' | 'D1' | 'overdue'
  workItemId: number
  projectId: number
  projectCode: string
  projectName: string
  itemKey: string
  title: string
  status: string
  priority: string
  severity?: string | null
  assigneeUid?: string | null
  projectLeaderUid?: string | null
  deptCode?: string | null
  dueAt: string
  eventVersion: string
  previousEventVersion?: string | null
  previousRecipientUid?: string | null
  idempotencyKey: string
  actionableKey: string
}

export interface AimsDueClosure {
  checkpointEventVersion: string
  expectedVersion: string
  actionableKey: string
  workItemId: number
  recipientUid: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
}

export interface DirectoryUser {
  uid?: string
  status?: number | string
}

export interface DueRecipientDependencies {
  findActiveUser: (uid: string) => Promise<DirectoryUser | null>
}

function text(value: unknown) {
  return String(value || '').trim()
}

function explicitUid(value: unknown) {
  const uid = text(value)
  return uid && uid.toLowerCase() !== '@all' ? uid : ''
}

export function aimsDueNotificationsEnabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
}

export async function resolveAimsDueRecipient(
  candidate: AimsDueCandidate,
  dependencies: DueRecipientDependencies
) {
  const candidates = [candidate.assigneeUid, candidate.projectLeaderUid]
    .map(explicitUid)
    .filter(Boolean)

  for (const uid of [...new Set(candidates)]) {
    const user = await dependencies.findActiveUser(uid)
    if (explicitUid(user?.uid) === uid && (user?.status === 1 || user?.status === 'active')) {
      return uid
    }
  }
  return null
}

export function aimsDueRecipientTransition(candidate: AimsDueCandidate, recipientUid: string) {
  const currentRecipientUid = explicitUid(recipientUid)
  const previousEventVersion = text(candidate.previousEventVersion)
  const previousRecipientUid = explicitUid(candidate.previousRecipientUid)
  return {
    previousObjectVersion: previousEventVersion && previousRecipientUid === currentRecipientUid
      ? previousEventVersion
      : null,
    previousRecipientClosure: previousEventVersion
      && previousRecipientUid
      && previousRecipientUid !== currentRecipientUid
      ? { expectedVersion: previousEventVersion, recipientUid: previousRecipientUid }
      : null
  }
}

export function aimsDueEventType(stream: AimsDueStream) {
  if (stream === 'response_due') return 'aims.service.response_due'
  if (stream === 'resolution_due') return 'aims.service.resolution_due'
  return 'aims.work_item.due'
}

export function aimsDueMessage(candidate: AimsDueCandidate) {
  const label = candidate.stream === 'response_due'
    ? '服务响应 SLA'
    : candidate.stream === 'resolution_due'
      ? '服务解决 SLA'
      : '高风险工作项'
  return {
    title: `${label} ${candidate.phase}：${candidate.itemKey}`,
    description: `${candidate.projectName} · ${candidate.title}；截止 ${candidate.dueAt}`,
    url: `/aims/projects/${encodeURIComponent(String(candidate.projectId))}/board?workItemId=${encodeURIComponent(String(candidate.workItemId))}`
  }
}
