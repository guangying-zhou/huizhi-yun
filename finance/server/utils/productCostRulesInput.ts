export interface ProductCostRulesCommand {
  actorUid: string
  projectCode: string
  periodMonth: string
  expectedRevision: number
  evidenceRef: string
  shares: Array<{ productCode: string, basisPoints: number }>
}

const key = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed()
  && value.length > 0 && value === value.trim() && [...value].length <= max && !/[/\\\p{Cc}]/u.test(value)

export function parseProductCostRulesInput(value: unknown): ProductCostRulesCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 6 || !key(input.actorUid, 64) || input.actorUid === '@all' || input.actorUid.startsWith('client:')
    || !key(input.projectCode, 50) || typeof input.periodMonth !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(input.periodMonth) || input.periodMonth.startsWith('0000')
    || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0 || Number(input.expectedRevision) >= Number.MAX_SAFE_INTEGER
    || typeof input.evidenceRef !== 'string' || !input.evidenceRef.isWellFormed() || !input.evidenceRef.trim()
    || new TextEncoder().encode(input.evidenceRef).length > 500 || /[\p{Cc}]/u.test(input.evidenceRef)
    || !Array.isArray(input.shares) || input.shares.length > 10000) return null
  const shares: ProductCostRulesCommand['shares'] = []
  const products = new Set<string>()
  let total = 0
  for (const row of input.shares) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 2
      || !key(row.productCode, 64) || products.has(row.productCode)
      || !Number.isSafeInteger(row.basisPoints) || row.basisPoints < 1 || row.basisPoints > 10000) return null
    total += row.basisPoints
    if (total > 10000) return null
    products.add(row.productCode)
    shares.push({ productCode: row.productCode, basisPoints: row.basisPoints })
  }
  return { actorUid: input.actorUid, projectCode: input.projectCode, periodMonth: input.periodMonth,
    expectedRevision: Number(input.expectedRevision), evidenceRef: input.evidenceRef, shares }
}
