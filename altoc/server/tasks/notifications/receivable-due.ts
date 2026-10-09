import { drainAltocReceivableDue } from '~~/server/utils/receivableDueNotificationDrain'

export default defineTask({
  meta: { name: 'notifications:receivable-due', description: '通知应收计划当前直接催收责任人' },
  async run({ context }) {
    const result = await drainAltocReceivableDue({ pageSize: 100, maxPages: 10, maxWallTimeMs: 45_000, taskContext: context as Record<string, unknown> })
    console.log('[altoc:notifications:receivable-due]', result)
    return { result }
  }
})
