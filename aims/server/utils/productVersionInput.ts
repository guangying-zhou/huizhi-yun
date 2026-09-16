import { productRequestPageInput } from './productRequestInput.ts'

export function productVersionCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'versionCode', 'name', 'description', 'plannedReleaseDate', 'businessOwnerUid', 'planningMode'].includes(key)) || !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 1) return null
  if (typeof v.versionCode !== 'string' || !v.versionCode || v.versionCode !== v.versionCode.trim() || [...v.versionCode].length > 64 || !v.versionCode.isWellFormed() || /\p{Cc}/u.test(v.versionCode)) return null
  const name = v.name ?? '', description = v.description ?? '', date = v.plannedReleaseDate ?? ''
  for (const [value, max] of [[name, 200], [description, 10000]] as const) if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > max || value.includes('\0')) return null
  if (typeof date !== 'string') return null
  if (date) {
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) return null
    const parsed = new Date(`${date}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null
  }
  if (Object.hasOwn(v, 'businessOwnerUid') && (typeof v.businessOwnerUid !== 'string' || !v.businessOwnerUid || v.businessOwnerUid !== v.businessOwnerUid.trim() || !v.businessOwnerUid.isWellFormed() || [...v.businessOwnerUid].length > 64 || /\p{Cc}/u.test(v.businessOwnerUid))) return null
  const planningMode = v.planningMode === undefined ? 'cycle' : v.planningMode
  if (planningMode !== 'simple' && planningMode !== 'cycle') return null
  return { ...(typeof v.businessOwnerUid === 'string' ? { business_owner_uid: v.businessOwnerUid } : {}), expected_revision: Number(v.expectedRevision), version_code: v.versionCode, name: name as string, description: description as string, planned_release_date: date, planning_mode: planningMode }
}
export function productVersionPageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'status'].includes(key))) return null
  const status = raw.status ?? ''
  if (typeof status !== 'string' || !['', 'planning', 'developing', 'released', 'archived'].includes(status)) return null
  const page = productRequestPageInput({ page: raw.page, pageSize: raw.pageSize, keyword: raw.keyword })
  return page ? { page: page.page, page_size: page.page_size, keyword: page.keyword, status } : null
}

export function productVersionID(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}
export function productVersionEditInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { expectedVersionRevision, reason, planningMode, ...draft } = raw as Record<string, unknown>
  if (Object.hasOwn(raw, 'planningMode')) return null
  const created = productVersionCreateInput(draft)
  if (!created) return null
  const { planning_mode: _planningMode, ...input } = created
  if (!input || !Number.isSafeInteger(versionID) || versionID < 1 || !Number.isSafeInteger(expectedVersionRevision) || Number(expectedVersionRevision) < 1 || typeof reason !== 'string' || !reason.trim() || !reason.isWellFormed() || [...reason].length > 2000 || reason.includes('\0')) return null
  return { ...input, version_id: versionID, expected_version_revision: Number(expectedVersionRevision), reason }
}
