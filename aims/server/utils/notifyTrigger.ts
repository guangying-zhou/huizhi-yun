/**
 * 通知触发工具 — 封装常用通知场景
 * 使用 notify.ts 中的 sendNotification 发送企业微信通知
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { buildAppHomeUrl } from '@hzy/foundation/server/utils/appUrls'

interface WorkItemInfoRow extends RowDataPacket {
  id: number
  item_key: string
  title: string
  assignee_uid: string | null
  project_id: number
  project_name: string
}

async function getWorkItemInfo(workItemId: number): Promise<WorkItemInfoRow | null> {
  return queryRow<WorkItemInfoRow>(
    `SELECT w.id, w.item_key, w.title, w.assignee_uid, w.project_id,
            p.name AS project_name
     FROM work_items w
     JOIN aims_projects p ON w.project_id = p.id
     WHERE w.id = ?`,
    [workItemId]
  )
}

const statusLabelMap: Record<string, string> = {
  planning: '规划中',
  todo: '待办',
  in_progress: '执行中',
  in_review: '确认中',
  completed: '已完成',
  // 项目生命周期状态
  draft: '草稿',
  approval_pending: '待立项',
  active: '进行中',
  paused: '暂停',
  archived: '已归档'
}

function statusLabel(status: string): string {
  return statusLabelMap[status] || status
}

function buildItemUrl(projectId: number, itemId: number): string {
  const config = useRuntimeConfig()
  const homeUrl = buildAppHomeUrl(
    config.public?.deploymentPublicUrl || process.env.HZY_DEPLOYMENT_PUBLIC_URL,
    config.public?.appBasePath || process.env.HZY_APP_BASE_PATH || process.env.NUXT_APP_BASE_URL || '/'
  ) || 'http://localhost:3002/'
  const url = new URL(`projects/${projectId}/tasks?item=${itemId}`, homeUrl.endsWith('/') ? homeUrl : `${homeUrl}/`)
  return url.toString()
}

/**
 * 通知任务分配
 */
export async function notifyTaskAssigned(
  workItemId: number,
  assigneeUid: string,
  assignerUid: string
) {
  try {
    const item = await getWorkItemInfo(workItemId)
    if (!item) return

    await sendNotification({
      touser: assigneeUid,
      title: '你有新任务',
      description: `[${item.project_name}] ${item.item_key} ${item.title}\n分配人: ${assignerUid}`,
      url: buildItemUrl(item.project_id, item.id)
    })
  } catch (error) {
    console.error('[NotifyTrigger] notifyTaskAssigned failed:', error)
  }
}

/**
 * 通知状态变更
 */
export async function notifyStatusChanged(
  workItemId: number,
  oldStatus: string,
  newStatus: string,
  changedByUid: string
) {
  try {
    const item = await getWorkItemInfo(workItemId)
    if (!item || !item.assignee_uid) return

    // 不通知自己的操作
    if (item.assignee_uid === changedByUid) return

    await sendNotification({
      touser: item.assignee_uid,
      title: '任务状态变更',
      description: `[${item.project_name}] ${item.item_key} ${item.title}\n状态: ${statusLabel(oldStatus)} → ${statusLabel(newStatus)}`,
      url: buildItemUrl(item.project_id, item.id)
    })
  } catch (error) {
    console.error('[NotifyTrigger] notifyStatusChanged failed:', error)
  }
}

/**
 * 通知到期提醒
 */
export async function notifyDueReminder(
  workItemId: number,
  daysUntilDue: number
) {
  try {
    const item = await getWorkItemInfo(workItemId)
    if (!item || !item.assignee_uid) return

    const urgency = daysUntilDue <= 0 ? '已逾期' : `将在 ${daysUntilDue} 天后到期`

    await sendNotification({
      touser: item.assignee_uid,
      title: '任务到期提醒',
      description: `[${item.project_name}] ${item.item_key} ${item.title}\n${urgency}`,
      url: buildItemUrl(item.project_id, item.id),
      btntxt: '立即处理'
    })
  } catch (error) {
    console.error('[NotifyTrigger] notifyDueReminder failed:', error)
  }
}
