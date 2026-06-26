/**
 * 截止日期提醒定时任务
 * 每小时检查一次即将到期和已逾期的需求，发送企业微信通知
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DueItemRow extends RowDataPacket {
  id: number
  item_key: string
  title: string
  assignee_uid: string
  due_date: string
  project_id: number
  project_name: string
  days_until_due: number
}

export default defineNitroPlugin((nitroApp) => {
  // TODO: 恢复到期提醒前，先接入 notification_rules / system_parameters 开关，
  // 避免继续以硬编码方式对所有项目统一发送提醒。
  return

  // 首次延迟 60 秒启动，之后每小时执行一次
  const INTERVAL = 60 * 60 * 1000 // 1 小时
  let timer: ReturnType<typeof setInterval> | null = null

  setTimeout(() => {
    checkDueItems()
    timer = setInterval(checkDueItems, INTERVAL)
  }, 60000)

  // 服务关闭时清理定时器
  nitroApp.hooks.hook('close', () => {
    if (timer) clearInterval(timer)
  })
})

async function checkDueItems() {
  try {
    // 查找：已逾期、今天到期、明天到期、3天内到期 的需求
    const rows = await queryRows<DueItemRow[]>(
      `SELECT w.id, w.item_key, w.title, w.assignee_uid, w.due_date,
              w.project_id, p.name AS project_name,
              DATEDIFF(w.due_date, CURDATE()) AS days_until_due
       FROM work_items w
       JOIN aims_projects p ON w.project_id = p.id
       WHERE w.assignee_uid IS NOT NULL
         AND w.due_date IS NOT NULL
         AND w.status != 'completed'
         AND DATEDIFF(w.due_date, CURDATE()) <= 3
       ORDER BY w.due_date ASC`
    )

    if (rows.length === 0) return

    console.log(`[DueReminder] Found ${rows.length} items due soon or overdue`)

    // 只在工作时间发送提醒（8:00-18:00）
    const hour = new Date().getHours()
    if (hour < 8 || hour > 18) {
      console.log('[DueReminder] Outside working hours, skipping notifications')
      return
    }

    for (const row of rows) {
      // 每天只提醒一次（通过简单的小时判断：只在 9 点和 14 点的检查中发送）
      if (hour !== 9 && hour !== 14) continue

      try {
        await notifyDueReminder(row.id, row.days_until_due)
      } catch (err) {
        console.error(`[DueReminder] Failed to notify for ${row.item_key}:`, err)
      }
    }
  } catch (err) {
    console.error('[DueReminder] Check failed:', err)
  }
}
