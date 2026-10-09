/**
 * 创建 Issue
 * POST /api/issues
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { issueProjectCode, issueRuntimeQuery, resolveIssueProjectAccess } from '~~/server/utils/issueProjectAccess'
import {
  buildCodocsNotification,
  codocsNotificationIdempotencyKey
} from '~~/server/utils/codocsNotificationBuilders'
import type { AccountUser } from '~/types/account'

const DEFAULT_ASSIGNEE = 'zhouguangying'

interface CreateIssueBody {
  project_code: string
  title: string
  description?: string
  issue_type?: string
  priority?: string
  assignee?: string | null
  created_by?: string
  document_uuid?: string | null
  tags?: string | null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateIssueBody>(event)
  const { project_code, title, description, issue_type, priority, assignee, document_uuid, tags } = body

  if (!project_code || !title) {
    throw createError({ statusCode: 400, message: '缺少必填字段：project_code, title' })
  }
  const access = await resolveIssueProjectAccess(event, issueProjectCode(project_code), 'edit')
  const creatorUid = access.actorUid

  const config = useRuntimeConfig()

  try {
    const finalAssignee = assignee || DEFAULT_ASSIGNEE

    const result = await callCodocsTenantRuntime<{ id: number }>(event, '/v1/codocs/issues', {
      method: 'POST',
      scope: 'codocs.write',
      query: issueRuntimeQuery({}, access.projectCode),
      body: {
        project_code: access.projectCode,
        title,
        description: description || null,
        issue_type: issue_type || 'bug',
        priority: priority || 'medium',
        assignee: finalAssignee,
        created_by: creatorUid,
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
    const notificationSeverity = priority === 'critical' ? 'error' : priority === 'high' ? 'warning' : 'info'

    // 获取提交人真实姓名
    let creatorName = creatorUid
    try {
      const usersRes = await fetchDirectoryResponse<AccountUser[]>('/users/batch', {
        method: 'POST',
        body: { uids: [creatorUid] },
        timeout: 5000
      })
      creatorName = usersRes.data?.[0]?.realName || creatorUid
    } catch {
      // 降级显示 uid
    }

    sendNotification(buildCodocsNotification({
      touser: finalAssignee,
      title: `新${typeLabel}：${title}`,
      description: `优先级：${priorityLabel}\n项目：${project_code}\n提交人：${creatorName}`,
      url: `${siteUrl}/projects/issues?project_code=${encodeURIComponent(access.projectCode)}&id=${insertId}`,
      btntxt: '查看详情',
      eventType: 'codocs.issue.created',
      category: 'project_issue',
      severity: notificationSeverity,
      bizType: 'project_issue',
      bizId: insertId,
      idempotencyKey: codocsNotificationIdempotencyKey('issue-created', insertId),
      metadata: {
        notificationKind: 'business_event',
        issueId: insertId,
        projectCode: access.projectCode,
        issueType: issue_type || 'bug',
        priority: priority || 'medium',
        assigneeUid: finalAssignee,
        creatorUid
      }
    })).catch((err) => {
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
