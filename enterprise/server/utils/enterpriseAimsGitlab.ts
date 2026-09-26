import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { getGitCommitDiff, listGitCommits } from '@hzy/foundation/server/utils/gitIntegration'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

// 工作项执行页的 GitLab 依赖。
//
// 提交列表是纯读取。提交 diff 是混合型：Runtime 只保存提交归属与 sha，
// diff 正文必须由本层直连 GitLab 取（Foundation gitIntegration 按 Console
// integration-config 解析凭据），取回后把文件变更数写回 Runtime。
// 这一半不能交给 Runtime：它没有也不该有 GitLab 凭据。

type GitlabOperation =
  | 'aims.project-gitlab-commits' | 'aims.project-gitlab-sync-context'
  | 'aims.project-gitlab-commit-ingest'
  | 'aims.work-item-commit-diff-metadata' | 'aims.work-item-commit-files-changed'

const permitResource: Record<GitlabOperation, string> = {
  'aims.project-gitlab-commits': 'project-gitlab',
  'aims.project-gitlab-sync-context': 'project-gitlab',
  'aims.project-gitlab-commit-ingest': 'project-gitlab',
  'aims.work-item-commit-diff-metadata': 'work-item-commit-diff',
  'aims.work-item-commit-files-changed': 'work-item-commit-diff'
}
const writeOperations = new Set<GitlabOperation>([
  'aims.project-gitlab-commit-ingest', 'aims.work-item-commit-files-changed'
])
const commitKeys = new Set(['page', 'pageSize', 'page_size', 'workItemId', 'work_item_id', 'repoProjectCode', 'unlinked'])
const numericID = /^[1-9]\d*$/
const commitID = /^[A-Za-z0-9._-]{1,64}$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
function requireID(event: H3Event, param: string, label: string) {
  const value = text(getRouterParam(event, param))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) {
    throw createError({ statusCode: 400, message: `${label}标识无效` })
  }
  return value
}

interface GitlabCall {
  projectId?: string
  objectId?: string
  subId?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function gitlabCall<T>(event: H3Event, operation: GitlabOperation, call: GitlabCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = writeOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'work_items', action, authorization.actionPolicies?.work_items)) {
    throw createError({ statusCode: 403, message: write ? '无工作项编辑权限' : '无工作项查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
    ...(call.subId ? { subId: call.subId } : {}),
    query: { ...(call.query || {}), ...scope },
    ...(call.payload ? { payload: call.payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: permitResource[operation],
      action: write ? 'edit' : 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {})
}

export async function enterpriseAimsProjectGitlabCommits(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!commitKeys.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '提交筛选参数无效' })
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '提交筛选参数无效' })
    query[key] = value
  }
  return await gitlabCall(event, 'aims.project-gitlab-commits', { projectId, query })
}

export async function enterpriseAimsWorkItemCommitDiff(event: H3Event) {
  const objectId = requireID(event, 'id', '工作项')
  const subId = text(getRouterParam(event, 'commitId'))
  if (!commitID.test(subId)) throw createError({ statusCode: 400, message: '提交标识无效' })

  const metadata = await gitlabCall<{ data?: Record<string, unknown> }>(event, 'aims.work-item-commit-diff-metadata', {
    objectId, subId
  })
  const meta = (metadata?.data || {}) as Record<string, unknown>
  const repoProjectCode = text(meta.repoProjectCode ?? meta.repo_project_code)
  const commitSha = text(meta.commitSha ?? meta.commit_sha)
  if (!repoProjectCode || !commitSha) {
    throw createError({ statusCode: 404, message: '提交不存在或未关联仓库' })
  }

  // diff 正文只能由本层取：Runtime 不持有 GitLab 凭据。
  // 与独立应用同一调用形态：repoPath 即仓库项目编码，凭据由 Foundation 按
  // Console integration-config 解析，不经本函数传递。
  const items = await getGitCommitDiff({ repoPath: repoProjectCode, sha: commitSha })

  // 文件变更数写回 Runtime，失败不影响本次读取
  try {
    await gitlabCall(event, 'aims.work-item-commit-files-changed', {
      objectId, subId, payload: { filesChanged: items.length },
      idempotencyKey: `commit-files-changed:${objectId}:${subId}`
    })
  } catch {
    // 写回失败只影响统计，不阻断 diff 返回
  }
  return { code: 0, data: { repoProjectCode, commitSha, diffs: items } }
}

interface SyncRepo { id: number, repoProjectCode: string, lastSyncedAt?: string | null }

// GitLab 同步：与独立应用同一编排 —— Runtime 给仓库清单与上次同步时间，
// 本层按仓库增量拉取提交，再整批交回 Runtime 入库。提交内容不经 Runtime 取，
// 因为凭据只在本层可解析。
export async function enterpriseAimsProjectSyncGitlab(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const context = await gitlabCall<{ data?: { repos?: SyncRepo[] } }>(event, 'aims.project-gitlab-sync-context', { projectId })
  const repos = context?.data?.repos || []

  const repoPayloads: Array<{ repoId: number, repoProjectCode: string, commits: unknown[] }> = []
  const failures: string[] = []
  for (const repo of repos) {
    const code = text(repo.repoProjectCode)
    if (!code) continue
    try {
      const since = repo.lastSyncedAt ? new Date(repo.lastSyncedAt).toISOString() : undefined
      const commits = await listGitCommits({ repoPath: code, since, perPage: 100 })
      if (Array.isArray(commits) && commits.length) {
        repoPayloads.push({ repoId: repo.id, repoProjectCode: code, commits })
      }
    } catch (error) {
      // 单个仓库失败不应中断整次同步，与独立应用一致
      failures.push(`${code}: ${(error as Error)?.message || '未知错误'}`)
    }
  }
  if (!repoPayloads.length) {
    return { code: 0, data: { ingested: 0, repos: 0, failures } }
  }
  const result = await gitlabCall<{ data?: Record<string, unknown> }>(event, 'aims.project-gitlab-commit-ingest', {
    projectId, payload: { repos: repoPayloads }, idempotencyKey: `gitlab-ingest:${projectId}:${Date.now()}`
  })
  return { code: 0, data: { ...(result?.data || {}), failures } }
}
