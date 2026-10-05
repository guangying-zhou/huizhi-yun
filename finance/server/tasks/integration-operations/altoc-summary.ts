import { drainAltocFinanceSummaryOperations } from '~~/server/utils/altocFinanceSummaryOperation'

export default defineTask({
  meta: { name: 'integration-operations:finance-altoc-summary', description: '可靠投递 Finance 核销后的 Altoc 财务摘要' },
  async run() {
    const result = await drainAltocFinanceSummaryOperations({ maxClaims: 20, maxWallTimeMs: 45_000, claimReserveMs: 25_000 })
    console.log('[finance:integration-operations:altoc-summary]', result)
    return { result }
  }
})
