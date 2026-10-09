import { createHash } from 'node:crypto'
import { upsertGitIssue } from '@hzy/foundation/server/utils/gitIntegration'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface GitlabIssueSyncItem {
  id: number
  itemKey: string
  type: string
  tier: string
  title: string
  description?: string | null
  status: string
  priority: string
  severity?: string | null
  assigneeUid?: string | null
  reporterUid?: string | null
  dueDate?: string | null
  updatedAt: string
  issueIid?: number | null
}

interface GitlabIssueSyncContext {
  project: { id: number, projectCode: string, name: string }
  repoProjectCode: string
  items: GitlabIssueSyncItem[]
}

interface SyncRequestBody {
  repoProjectCode?: string
  workItemIds?: number[]
}

function issueDescription(context: GitlabIssueSyncContext, item: GitlabIssueSyncItem) {
  const metadata = [
    `- AIMS 工作项：${item.itemKey}`,
    `- 项目：${context.project.projectCode} ${context.project.name}`,
    `- 类型：${item.type}`,
    `- 状态：${item.status}`,
    `- 优先级：${item.priority}`,
    item.assigneeUid ? `- 负责人：${item.assigneeUid}` : '',
    item.dueDate ? `- 截止日期：${item.dueDate}` : '',
    `- AIMS 路径：/projects/${context.project.id}/board/${item.id}`
  ].filter(Boolean).join('\n')
  return [item.description?.trim(), '---', metadata].filter(Boolean).join('\n\n')
}

function issueLabels(item: GitlabIssueSyncItem) {
  return [
    'hzy::aims',
    `aims::${item.type}`,
    `priority::${item.priority.toLowerCase()}`
  ]
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  const projectId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }
  const body = await readBody<SyncRequestBody>(event)
  const repoProjectCode = String(body?.repoProjectCode || '').trim()
  if (!repoProjectCode) {
    throw createError({ statusCode: 400, message: 'repoProjectCode 必填' })
  }
  const workItemIds = Array.isArray(body?.workItemIds)
    ? [...new Set(body.workItemIds.filter(id => Number.isInteger(id) && id > 0))]
    : []
  if (workItemIds.length > 100 || (Array.isArray(body?.workItemIds) && workItemIds.length !== body.workItemIds.length)) {
    throw createError({ statusCode: 400, message: 'workItemIds 必须是最多 100 个不重复的正整数' })
  }

  const runtimeQuery = await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })
  const context = await forwardAimsRuntimeGet<GitlabIssueSyncContext>(
    event,
    `/v1/aims/projects/${projectId}/gitlab-issue-sync-context`,
    {
      uid,
      query: {
        ...runtimeQuery,
        repoProjectCode,
        ...(workItemIds.length ? { workItemIds: workItemIds.join(',') } : {})
      }
    }
  )

  const links: Array<Record<string, unknown>> = []
  const failures: Array<{ workItemId: number, itemKey: string, message: string }> = []
  for (const item of context.items) {
    try {
      const idempotencyKey = createHash('sha256')
        .update(`aims:gitlab-issue:${context.repoProjectCode}:${item.itemKey}:${item.updatedAt}`)
        .digest('hex')
      const issue = await upsertGitIssue({
        repoPath: context.repoProjectCode,
        externalKey: item.itemKey,
        title: `[${item.itemKey}] ${item.title}`,
        description: issueDescription(context, item),
        state: item.status === 'completed' ? 'closed' : 'opened',
        labels: issueLabels(item),
        dueDate: item.dueDate || undefined,
        issueIid: item.issueIid || undefined,
        idempotencyKey
      })
      links.push({
        workItemId: item.id,
        issueIid: issue.iid,
        issueUrl: issue.webUrl,
        issueState: issue.state,
        created: issue.created
      })
    } catch {
      failures.push({ workItemId: item.id, itemKey: item.itemKey, message: 'GitLab Issue 同步失败' })
    }
  }

  if (links.length) {
    await forwardAimsRuntimePost(
      event,
      `/v1/aims/projects/${projectId}/gitlab-issue-links/ingest`,
      {
        uid,
        query: runtimeQuery,
        body: { repoProjectCode: context.repoProjectCode, items: links }
      }
    )
  }

  return {
    code: 0,
    data: {
      repoProjectCode: context.repoProjectCode,
      requested: context.items.length,
      synced: links.length,
      failed: failures.length,
      links,
      failures
    }
  }
})
