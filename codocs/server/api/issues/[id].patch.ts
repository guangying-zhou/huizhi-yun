/**
 * 更新 Issue
 * PATCH /api/issues/:id
 */
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import type { AccountUser } from '~/types/account'

interface IssueRow {
  title: string
  created_by: string
  assignee: string | null
  project_code: string
  issue_type: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Record<string, unknown>>(event)

  // 允许更新的字段
  const allowedFields = ['title', 'description', 'issue_type', 'status', 'priority', 'assignee', 'document_uuid', 'tags', 'resolution']
  const updates: Record<string, string | number | boolean | null> = {}

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      const value = body[field]
      updates[field] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? value : String(value)
    }
  }
  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, message: '没有可更新的字段' })
  }

  if (!id) {
    throw createError({ statusCode: 400, message: '缺少Issue ID' })
  }

  try {
    // 标记解决时，先查原始 issue 信息用于发通知
    let issueRow: IssueRow | null = null
    if (body.status === 'resolved') {
      issueRow = await callCodocsTenantRuntime<IssueRow>(event, `/v1/codocs/issues/${encodeURIComponent(id)}`, {
        scope: 'codocs.read'
      })
    }

    await callCodocsTenantRuntime(event, `/v1/codocs/issues/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      scope: 'codocs.write',
      body: updates
    })

    // 标记解决时发企业微信通知给发起人
    if (body.status === 'resolved' && issueRow) {
      const config = useRuntimeConfig()
      const siteUrl = (config.public as { siteUrl?: string }).siteUrl || 'https://codocs.wiztek.cn'
      const resolution = typeof body.resolution === 'string' ? body.resolution : ''

      // 获取处理人真实姓名
      let assigneeName = issueRow.assignee || '未分配'
      if (issueRow.assignee) {
        try {
          const usersRes = await fetchDirectoryResponse<AccountUser[]>('/users/batch', {
            method: 'POST',
            body: { uids: [issueRow.assignee] },
            timeout: 5000
          })
          assigneeName = usersRes.data?.[0]?.realName || issueRow.assignee
        } catch {
          // 降级显示 uid
        }
      }

      sendNotification({
        touser: issueRow.created_by,
        title: `已解决：${issueRow.title}`,
        description: `处理结果：${resolution || '无'}\n项目：${issueRow.project_code}\n处理人：${assigneeName}`,
        url: `${siteUrl}/projects/issues?id=${id}`,
        btntxt: '查看详情'
      }).catch((err) => {
        console.warn('[Issues] Failed to send resolve notification:', err)
      })
    }

    return { success: true, message: '更新成功' }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to update issue:', error)
    throw createError({ statusCode: 500, message: '更新Issue失败' })
  }
})
