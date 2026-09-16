import { hasProductControlCharacter } from './productWorkspaceInput.ts'

export function productOnboardInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['productCode', 'managerUid', 'positioning', 'targetUsers', 'valueStatement', 'reason'].includes(key))) return null
  for (const field of ['productCode', 'managerUid'] as const) {
    const id = value[field]
    if (typeof id !== 'string' || !id || id !== id.trim() || [...id].length > 64 || /[/,]/.test(id) || hasProductControlCharacter(id)) return null
  }
  if (typeof value.reason !== 'string' || !value.reason.trim() || [...value.reason].length > 2000) return null
  for (const key of ['positioning', 'targetUsers', 'valueStatement']) {
    if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'string' || [...value[key] as string].length > 10000)) return null
  }
  return {
    productCode: value.productCode as string,
    input: {
      manager_uid: value.managerUid as string,
      positioning: (value.positioning ?? null) as string | null,
      target_users: (value.targetUsers ?? null) as string | null,
      value_statement: (value.valueStatement ?? null) as string | null,
      reason: value.reason
    }
  }
}
