import { callAimsScheduledRuntime } from '~~/server/utils/scheduledRuntime'
import { isUnifiedMilestoneRolloverOwner } from '~~/server/utils/milestoneRolloverOwner'

interface RolloverDueResult {
  skipped?: 'unified_scheduler_owner'
  scanned?: number
  rolled_over?: number
  pending?: number
  pendingItems?: Array<Record<string, unknown>>
  failed?: number
  failures?: Array<Record<string, unknown>>
}

export default defineTask({
  meta: {
    name: 'milestones:rollover',
    description: '扫描到期周期性里程碑并开启下一周期'
  },
  async run() {
    const startAt = Date.now()
    try {
      const result = await callAimsScheduledRuntime<RolloverDueResult>(
        '/v1/aims/service/milestones:rollover-due',
        {
          scope: 'aims.write',
          method: 'POST',
          body: { operator_uid: 'system' }
        }
      )
      const elapsed = Date.now() - startAt
      console.log(
        `[milestones:rollover] done in ${elapsed}ms - `
        + `scanned=${result.scanned || 0} `
        + `rolled_over=${result.rolled_over || 0} `
        + `pending=${result.pending || 0} `
        + `failed=${result.failed || 0}`
      )
      return { result }
    } catch (err) {
      if (isUnifiedMilestoneRolloverOwner(err)) {
        console.log('[milestones:rollover] skipped: owned by the unified scheduler wake')
        return { result: { skipped: 'unified_scheduler_owner' as const } }
      }
      console.error('[milestones:rollover] failed:', err)
      throw err
    }
  }
})
