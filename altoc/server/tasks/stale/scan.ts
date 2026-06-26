import { callAltocScheduledRuntime } from '~~/server/utils/scheduledRuntime'
import {
  notifyOpportunityStaleItems,
  type OpportunityStaleNotice
} from '~~/server/utils/runtimeNotifications'

interface StaleScanResult {
  scanned?: number
  stale_ids?: number[]
  items?: OpportunityStaleNotice[]
  notified_owners?: number
}

/**
 * Nitro Scheduled Task：商机超期未跟进扫描。
 *
 * 数据扫描由 tenant-runtime 执行，Nuxt 侧只负责通知编排。
 */
export default defineTask({
  meta: {
    name: 'stale:scan',
    description: '扫描超期未跟进的 active 商机并通知负责人'
  },
  async run() {
    const startAt = Date.now()
    try {
      const result = await callAltocScheduledRuntime<StaleScanResult>(
        '/v1/altoc/opportunities/scan-stale',
        {
          scope: 'altoc.write altoc:opportunity:edit',
          method: 'POST',
          body: { staleDays: 7 }
        }
      )
      const notifiedOwners = await notifyOpportunityStaleItems(Array.isArray(result.items) ? result.items : [])
      const finalResult = { ...result, notified_owners: notifiedOwners }
      const elapsed = Date.now() - startAt
      console.log(
        `[stale:scan] done in ${elapsed}ms - `
        + `stale=${finalResult.scanned || 0} `
        + `notified_owners=${finalResult.notified_owners || 0}`
      )
      return { result: finalResult }
    } catch (err) {
      console.error('[stale:scan] failed:', err)
      throw err
    }
  }
})
