/**
 * 创建 Issue
 * POST /api/issues
 */
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import type { AccountUser, Project } from '~/types/account'

const DEFAULT_ASSIGNEE = 'zhouguangying'

interface CreateIssueBody {
  project_code: string
  title: string
  description?: string
  issue_type?: string
  priority?: string
  assignee?: string | null
  created_by: string
  document_uuid?: string | null
  tags?: string | null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateIssueBody>(event)
  const { project_code, title, description, issue_type, priority, assignee, created_by, document_uuid, tags } = body

  if (!project_code || !title || !created_by) {
    throw createError({ statusCode: 400, message: '缺少必填字段：project_code, title, created_by' })
  }

  const config = useRuntimeConfig()

  try {
    const projectResponse = await fetchDirectoryResponse<Project>(
      `/projects/${encodeURIComponent(project_code)}`,
      { timeout: 10000 }
    )

    if (projectResponse.code !== 0 || !projectResponse.data) {
      throw createError({ statusCode: 400, message: '无效的项目编码' })
    }

    const finalAssignee = assignee || DEFAULT_ASSIGNEE

    const result = await callCodocsTenantRuntime<{ id: number }>(event, '/v1/codocs/issues', {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        project_code,
        title,
        description: description || null,
        issue_type: issue_type || 'bug',
        priority: priority || 'medium',
        assignee: finalAssignee,
        created_by,
        document_uuid: document_uuid || null,
        tags: tags || null
      }
    })

    const insertId = result.id

    // 发送企业微信通知给指派人
    const siteUrl = (config.public as { siteUrl?: string }).siteUrl || 'https://codocs.wiztek.cn'
    const typeLabel = (issue_type || 'bug') === 'bug' ? 'Bug' : '需求'
    const priorityMap: Record<string, string> = { critical: '紧急', high: '高', medium: '中', low: '低' }
    const priorityLabel = priorityMap[priority || 'medium'] || '中'

    // 获取提交人真实姓名
    let creatorName = created_by
    try {
      const usersRes = await fetchDirectoryResponse<AccountUser[]>('/users/batch', {
        method: 'POST',
        body: { uids: [created_by] },
        timeout: 5000
      })
      creatorName = usersRes.data?.[0]?.realName || created_by
    } catch {
      // 降级显示 uid
    }

    sendNotification({
      touser: finalAssignee,
      title: `新${typeLabel}：${title}`,
      description: `优先级：${priorityLabel}\n项目：${project_code}\n提交人：${creatorName}`,
      url: `${siteUrl}/projects/issues?id=${insertId}`,
      btntxt: '查看详情'
    }).catch((err) => {
      console.warn('[Issues] Failed to send wecom notification:', err)
    })

    return {
      success: true,
      data: { id: insertId },
      message: '创建成功'
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to create issue:', error)
    throw createError({ statusCode: 500, message: '创建Issue失败' })
  }
})
