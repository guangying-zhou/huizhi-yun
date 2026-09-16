import { drainFinanceDueNotifications } from '~~/server/utils/dueNotificationDrain'

export default defineTask({
  meta: { name: 'notifications:finance-due', description: '扫描已批未开票与到账未核销事项并通知当前直接责任人' },
  async run({ context }) {
    const result = await drainFinanceDueNotifications({ pageSize: 100, maxPagesPerStream: 10, maxWallTimeMs: 45_000, taskContext: context as Record<string, unknown> })
    console.log('[finance:notifications:due]', result)
    return { result }
  }
})
