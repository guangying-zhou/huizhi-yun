import { createHash } from 'node:crypto'

type RuntimeRow = Record<string, unknown>

export interface ContributionSyncIdentityInput {
  explicitIdempotencyKey?: unknown
  projectId: unknown
  cycleCode: unknown
  periodStart: unknown
  periodEnd: unknown
  inputHash?: unknown
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

export function buildContributionIdempotencyKey(input: ContributionSyncIdentityInput) {
  const explicit = text(input.explicitIdempotencyKey)
  if (explicit) return explicit
  return [
    'aims:people-contributions',
    text(input.projectId),
    text(input.cycleCode),
    text(input.periodStart),
    text(input.periodEnd),
    text(input.inputHash)
  ].join(':')
}

export function contributionInputHash(items: RuntimeRow[]) {
  const ordered = [...items].sort((left, right) => {
    const leftKey = `${text(left.employee_uid || left.employeeUid)}:${text(left.source_biz_id || left.sourceBizId)}`
    const rightKey = `${text(right.employee_uid || right.employeeUid)}:${text(right.source_biz_id || right.sourceBizId)}`
    return leftKey.localeCompare(rightKey)
  })
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

export function groupContributionItems(entries: RuntimeRow[], body: RuntimeRow) {
  const defaultRoleCode = text(body.roleCode || body.role_code) || 'delivery'
  const groups = new Map<string, {
    employeeUid: string
    projectCode: string
    workHours: number
    timeEntryIds: unknown[]
    workItemKeys: string[]
  }>()

  for (const entry of entries) {
    const employeeUid = text(entry.uid || entry.employee_uid || entry.employeeUid)
    const projectCode = text(entry.projectCode || entry.project_code)
    if (!employeeUid || !projectCode) continue

    const key = `${projectCode}:${employeeUid}`
    const current = groups.get(key) || {
      employeeUid,
      projectCode,
      workHours: 0,
      timeEntryIds: [],
      workItemKeys: []
    }
    current.workHours += numberValue(entry.hours)
    if (entry.id !== undefined && entry.id !== null) current.timeEntryIds.push(entry.id)
    const itemKey = text(entry.itemKey || entry.item_key)
    if (itemKey && !current.workItemKeys.includes(itemKey)) current.workItemKeys.push(itemKey)
    groups.set(key, current)
  }

  return [...groups.values()].map(group => ({
    employee_uid: group.employeeUid,
    project_code: group.projectCode,
    role_code: defaultRoleCode,
    work_hours: Number(group.workHours.toFixed(2)),
    score_status: 'unscored',
    source_app: 'aims',
    source_biz_type: 'time_entries',
    source_biz_id: `${group.projectCode}:${group.employeeUid}`,
    source_refs: {
      time_entries: group.timeEntryIds,
      work_items: group.workItemKeys,
      review_status: 'approved'
    }
  }))
}
