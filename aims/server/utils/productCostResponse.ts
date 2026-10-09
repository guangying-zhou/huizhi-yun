import type { ProductCostResult } from '../../app/types/productCost'

export function parseProductCostResponse(value: unknown, productCode: string, projectCode: string, periodMonth: string): ProductCostResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.productCode !== productCode || row.projectCode !== projectCode || row.periodMonth !== periodMonth
    || typeof row.ready !== 'boolean' || !Array.isArray(row.reasons) || !row.reasons.every(reason => typeof reason === 'string' && /^[a-z_]+$/.test(reason))
    || !Number.isSafeInteger(row.ruleRevision) || Number(row.ruleRevision) < 0
    || typeof row.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceRevision)
    || !(row.basisPoints === null || (Number.isSafeInteger(row.basisPoints) && Number(row.basisPoints) > 0 && Number(row.basisPoints) <= 10000))
    || !Array.isArray(row.costs) || row.costBasis !== 'finance_non_canceled_expense_and_active_allocations_v1'
    || row.revenueReady !== false || row.revenueReason !== 'revenue_attribution_not_configured') return null
  const costs: Array<{ currencyCode: string, amount: string }> = []
  for (const item of row.costs) {
    if (!item || typeof item !== 'object' || typeof item.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(item.currencyCode)
      || typeof item.amount !== 'string' || !/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/.test(item.amount)
      || costs.some(cost => cost.currencyCode === item.currencyCode)) return null
    costs.push({ currencyCode: item.currencyCode, amount: item.amount })
  }
  if (row.ready ? row.reasons.length !== 0 || row.basisPoints === null || costs.length === 0 || Number(row.ruleRevision) < 1 : costs.length !== 0 || row.reasons.length === 0) return null
  return {
    productCode, projectCode, periodMonth, ready: row.ready, reasons: row.reasons as string[],
    ruleRevision: Number(row.ruleRevision), sourceRevision: row.sourceRevision,
    basisPoints: row.basisPoints === null ? null : Number(row.basisPoints), costs,
    costBasis: row.costBasis, revenueReady: false as const, revenueReason: row.revenueReason
  }
}
