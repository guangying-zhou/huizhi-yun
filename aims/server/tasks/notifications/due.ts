import { drainAimsDueNotifications } from '~~/server/utils/dueNotificationDrain'
import { isUnifiedDueNotificationOwner } from '~~/server/utils/milestoneRolloverOwner'

export default defineTask({
  meta: {
    name: 'notifications:due',
    description: '按冻结时点扫描 Aims SLA 与高风险工作项并统一通知明确责任人'
  },
  async run({ context }) {
    let result: Record<string, unknown>
    try {
      result = await drainAimsDueNotifications({
        pageSize: 100,
        maxPagesPerStream: 10,
        maxWallTimeMs: 45_000,
        taskContext: context as Record<string, unknown>
      })
    } catch (error) {
      if (!isUnifiedDueNotificationOwner(error)) throw error
      result = { enabled: true, skipped: 'unified_scheduler_owner' }
    }
    console.log('[notifications:due]', result)
    return { result }
  }
})
