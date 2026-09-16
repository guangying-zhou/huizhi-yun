export interface ProductCostResult {
  productCode: string
  projectCode: string
  periodMonth: string
  ready: boolean
  reasons: string[]
  ruleRevision: number
  sourceRevision: string
  basisPoints: number | null
  costs: Array<{ currencyCode: string, amount: string }>
  costBasis: string
  revenueReady: false
  revenueReason: string
}
