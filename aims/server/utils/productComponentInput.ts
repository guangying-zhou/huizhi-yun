import { productVersionID } from './productVersionInput.ts'
import { productRequestPageInput } from './productRequestInput.ts'

const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0
const validText = (v: unknown, max: number) => typeof v === 'string' && v.isWellFormed() && [...v].length <= max && !v.includes('\0')

export function productComponentPageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['parentId', 'page', 'pageSize'].includes(key))) return null
  const parentID = raw.parentId === undefined ? null : productVersionID(raw.parentId)
  if (raw.parentId !== undefined && parentID === null) return null
  const page = productRequestPageInput({ page: raw.page, pageSize: raw.pageSize })
  return page ? { parent_id: parentID, page: page.page, page_size: page.page_size } : null
}

export function productComponentWriteInput(raw: unknown, componentID?: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const moving = componentID !== undefined
  const allowed = moving ? ['parentId', 'expectedRevision', 'expectedComponentRevision', 'reason'] : ['parentId', 'expectedRevision', 'name', 'description', 'sortOrder']
  if (Object.keys(v).some(key => !allowed.includes(key)) || !positive(v.expectedRevision)) return null
  // Explicit null means root; omission must not accidentally detach a module.
  if (!Object.hasOwn(v, 'parentId') || (v.parentId !== null && !positive(v.parentId))) return null
  const base = { parent_id: v.parentId as number | null, expected_revision: Number(v.expectedRevision) }
  if (moving) {
    if (!positive(componentID) || !positive(v.expectedComponentRevision) || !validText(v.reason, 2000) || !(v.reason as string).trim()) return null
    return { ...base, component_id: componentID, expected_component_revision: Number(v.expectedComponentRevision), reason: v.reason as string }
  }
  const description = v.description ?? '', sortOrder = v.sortOrder ?? 0
  if (!validText(v.name, 255) || !(v.name as string).trim() || !validText(description, 10000) || !Number.isInteger(sortOrder) || Number(sortOrder) < -2147483648 || Number(sortOrder) > 2147483647) return null
  return { ...base, name: v.name as string, description: description as string, sort_order: Number(sortOrder) }
}

export function productComponentEditInput(raw: unknown, componentID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(componentID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['name', 'description', 'sortOrder', 'expectedRevision', 'expectedComponentRevision', 'reason'].includes(key))) return null
  if (!positive(v.expectedRevision) || !positive(v.expectedComponentRevision) || !validText(v.name, 255) || !(v.name as string).trim() || !validText(v.description, 10000) || !validText(v.reason, 2000) || !(v.reason as string).trim() || !Number.isInteger(v.sortOrder) || Number(v.sortOrder) < -2147483648 || Number(v.sortOrder) > 2147483647) return null
  return { component_id: componentID, name: v.name as string, description: v.description as string, sort_order: Number(v.sortOrder), expected_revision: Number(v.expectedRevision), expected_component_revision: Number(v.expectedComponentRevision), reason: v.reason as string }
}

export function productComponentDeleteInput(raw: unknown, componentID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(componentID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedComponentRevision', 'reason'].includes(key)) || !positive(v.expectedRevision) || !positive(v.expectedComponentRevision) || !validText(v.reason, 2000) || !(v.reason as string).trim()) return null
  return { component_id: componentID, expected_revision: Number(v.expectedRevision), expected_component_revision: Number(v.expectedComponentRevision), reason: v.reason as string }
}
