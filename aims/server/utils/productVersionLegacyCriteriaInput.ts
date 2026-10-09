import { productVersionArchiveInput } from './productVersionArchiveInput'

export function productVersionLegacyCriteriaInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { acceptanceCriteria, ...rest } = raw as Record<string, unknown>
  const base = productVersionArchiveInput(rest, versionID)
  if (!base || typeof acceptanceCriteria !== 'string' || !acceptanceCriteria.trim() || !acceptanceCriteria.isWellFormed() || [...acceptanceCriteria].length > 10000 || acceptanceCriteria.includes('\0')) return null
  return { ...base, acceptance_criteria: acceptanceCriteria }
}
