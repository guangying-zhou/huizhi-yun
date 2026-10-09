import { hasProductControlCharacter } from './productWorkspaceInput.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const crossDependencyProductCode = (value: unknown): value is string => typeof value === 'string' && !!value && value === value.trim() && value.isWellFormed() && [...value].length <= 64 && !value.includes('/') && !hasProductControlCharacter(value)
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const reasonText = (value: unknown): value is string => typeof value === 'string' && value.isWellFormed() && !value.includes('\0') && [...value].length <= 2000

export function crossDependencyWriteInput(raw: unknown, source: string, itemId: string, dependencyId?: string) {
  if (!crossDependencyProductCode(source) || !uuid.test(itemId) || (dependencyId !== undefined && !uuid.test(dependencyId)) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const fields = ['predecessorProductCode', 'predecessorId', 'expectedRevision', 'expectedItemRevision', 'expectedPredecessorProductRevision', 'expectedPredecessorRevision', 'reason', 'impactNote', ...(dependencyId === undefined ? [] : ['expectedDependencyRevision'])]
  if (Object.keys(value).some(key => !fields.includes(key)) || !crossDependencyProductCode(value.predecessorProductCode) || value.predecessorProductCode === source || typeof value.predecessorId !== 'string' || !uuid.test(value.predecessorId) || value.predecessorId === itemId || !['expectedRevision', 'expectedItemRevision', 'expectedPredecessorProductRevision', 'expectedPredecessorRevision'].every(key => positive(value[key])) || !reasonText(value.reason) || !value.reason.trim() || !reasonText(value.impactNote ?? '') || (dependencyId !== undefined && !positive(value.expectedDependencyRevision))) return null
  return { item_biz_id: itemId, predecessor_product_code: value.predecessorProductCode, predecessor_biz_id: value.predecessorId, expected_revision: Number(value.expectedRevision), expected_item_revision: Number(value.expectedItemRevision), expected_predecessor_product_revision: Number(value.expectedPredecessorProductRevision), expected_predecessor_revision: Number(value.expectedPredecessorRevision), reason: value.reason, impact_note: (value.impactNote ?? '') as string, ...(dependencyId === undefined ? {} : { dependency_biz_id: dependencyId, expected_dependency_revision: Number(value.expectedDependencyRevision) }) }
}
