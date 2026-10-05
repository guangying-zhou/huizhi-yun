import { parseProductCostRulesInput } from './productCostRulesInput'

export function parseProductCostRulesReadInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4 || input.action !== 'read') return null
  const validated = parseProductCostRulesInput({ actorUid: input.actorUid, projectCode: input.projectCode,
    periodMonth: input.periodMonth, expectedRevision: 0, evidenceRef: 'read', shares: [] })
  if (!validated) return null
  return { actorUid: validated.actorUid, projectCode: validated.projectCode, periodMonth: validated.periodMonth, action: 'read' as const }
}

export function parseProductCostRulesReadResult(value: unknown, projectCode: string, periodMonth: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (result.projectCode !== projectCode || result.periodMonth !== periodMonth || !Number.isSafeInteger(result.revision) || Number(result.revision) < 0) return null
  if (result.revision === 0) {
    if (result.evidenceRef !== '' || !Array.isArray(result.shares) || result.shares.length) return null
    return { projectCode, periodMonth, revision: 0, evidenceRef: '', shares: [] as Array<{ productCode: string, basisPoints: number }> }
  }
  const validated = parseProductCostRulesInput({ actorUid: 'read-validation', projectCode, periodMonth,
    expectedRevision: Number(result.revision) - 1, evidenceRef: result.evidenceRef, shares: result.shares })
  if (!validated) return null
  return { projectCode, periodMonth, revision: Number(result.revision), evidenceRef: validated.evidenceRef, shares: validated.shares }
}
