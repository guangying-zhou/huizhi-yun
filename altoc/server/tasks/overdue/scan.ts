import { callAltocScheduledRuntime } from '~~/server/utils/scheduledRuntime'
import {
  notifyReceivableOverdueItems,
  type ReceivableOverdueNotice
} from '~~/server/utils/runtimeNotifications'

interface OverdueScanResult {
  scanned?: number
  marked_overdue?: number
  updated_days?: number
  newly_overdue?: ReceivableOverdueNotice[]
  overdue_ids?: number[]
  notified_owners?: number
}

/**
 * Nitro Scheduled Task：回款计划逾期扫描。
 *
 * 数据扫描和状态更新由 tenant-runtime 执行，避免 scheduled task 直连
 * Altoc 本地数据库。
 */
export default defineTask({
  meta: {
    name: 'overdue:scan',
    description: '扫描回款计划，标记逾期并刷新 overdue_days'
  },
  async run() {
    const startAt = Date.now()
    try {
      const result = await callAltocScheduledRuntime<OverdueScanResult>(
        '/v1/altoc/payments/scan-overdue',
        {
          scope: 'altoc.write altoc:receivable:edit',
          method: 'POST',
          body: {}
        }
      )
      const notifiedOwners = await notifyReceivableOverdueItems(
        Array.isArray(result.newly_overdue) ? result.newly_overdue : []
      )
      const finalResult = { ...result, notified_owners: notifiedOwners }
      const elapsed = Date.now() - startAt
      console.log(
        `[overdue:scan] done in ${elapsed}ms - `
        + `marked_overdue=${finalResult.marked_overdue || 0} `
        + `updated_days=${finalResult.updated_days || 0} `
        + `scanned=${finalResult.scanned || 0}`
      )
      return { result: finalResult }
    } catch (err) {
      console.error('[overdue:scan] failed:', err)
      throw err
    }
  }
})
