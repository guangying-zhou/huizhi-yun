export interface ProductCostRules {
  projectCode: string
  periodMonth: string
  revision: number
  evidenceRef: string
  shares: Array<{ productCode: string, basisPoints: number }>
}

export function parseProductCostRulesResponse(value: unknown, projectCode: string, periodMonth: string): ProductCostRules | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.projectCode !== projectCode || row.periodMonth !== periodMonth || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
    || typeof row.evidenceRef !== 'string' || !row.evidenceRef.isWellFormed() || new TextEncoder().encode(row.evidenceRef).length > 500
    || /[\p{Cc}]/u.test(row.evidenceRef) || !Array.isArray(row.shares) || row.shares.length > 10000) return null
  if (row.revision === 0 ? row.evidenceRef !== '' || row.shares.length !== 0 : !row.evidenceRef.trim()) return null
  const shares: ProductCostRules['shares'] = []
  const seen = new Set<string>()
  let total = 0
  for (const item of row.shares) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.productCode !== 'string'
      || !item.productCode.isWellFormed() || !item.productCode || item.productCode !== item.productCode.trim()
      || [...item.productCode].length > 64 || /[/\\\p{Cc}]/u.test(item.productCode) || seen.has(item.productCode)
      || !Number.isSafeInteger(item.basisPoints) || item.basisPoints < 1 || item.basisPoints > 10000) return null
    total += item.basisPoints
    if (total > 10000) return null
    seen.add(item.productCode)
    shares.push({ productCode: item.productCode, basisPoints: item.basisPoints })
  }
  return { projectCode, periodMonth, revision: Number(row.revision), evidenceRef: row.evidenceRef, shares }
}
