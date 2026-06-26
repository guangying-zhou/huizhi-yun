/**
 * 手动触发 GitLab 提交同步
 * POST /api/v1/projects/:id/sync-gitlab
 *
 * 职责拆分：
 *   - 本接口负责经 Foundation 集成调用 GitLab API 拉取提交（凭证由 Console 解析）
 *   - 同步上下文读取、commit 落库、工作项编号匹配与仓库游标更新在 tenant-runtime 侧完成
 */
import { listGitCommits } from '@hzy/foundation/server/utils/gitIntegration'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface SyncContext {
  project: { id: number, projectCode: string, name: string }
  repos: Array<{
    id: number
    repoProjectCode: string
    lastCommitSha?: string
    lastSyncedAt?: string
  }>
}

interface GitCommit {
  sha: string
  shortSha: string
  title: string
  message: string
  authorName: string
  authorEmail: string
  authoredDate: string
  committedDate: string
  webUrl: string
  additions: number | null
  deletions: number | null
  total: number | null
}

interface IngestResult {
  synced: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const runtimeQuery = await buildAimsProjectRuntimeAccessQuery(event, { projectId: id, uid })

  const context = await forwardAimsRuntimeGet<SyncContext>(
    event,
    `/v1/aims/projects/${id}/gitlab-sync-context`,
    { uid, query: runtimeQuery }
  )

  if (!context.repos.length) {
    return {
      code: 0,
      data: { message: '该项目未关联任何代码仓库', synced: 0 }
    }
  }

  const repoPayloads: Array<{ repoId: number, repoProjectCode: string, commits: GitCommit[] }> = []
  for (const repo of context.repos) {
    // 分页获取全部提交（增量：since 上次同步时间）
    const since = repo.lastSyncedAt ? new Date(repo.lastSyncedAt).toISOString() : undefined

    let allCommits: GitCommit[] = []
    let page = 1
    const perPage = 100
    try {
      while (true) {
        const commits = await listGitCommits({
          projectCode: repo.repoProjectCode,
          since,
          page,
          perPage
        })
        if (!commits.length) break
        allCommits = allCommits.concat(commits)
        if (commits.length < perPage) break
        page++
      }
    } catch (err: unknown) {
      const errMsg = (err as { data?: { message?: string } })?.data?.message || (err as Error).message || '未知错误'
      console.warn(`[SyncGitlab] Failed to fetch commits for ${repo.repoProjectCode}:`, errMsg)
      // 不中断其他仓库
      continue
    }

    if (allCommits.length) {
      repoPayloads.push({ repoId: repo.id, repoProjectCode: repo.repoProjectCode, commits: allCommits })
    }
  }

  let synced = 0
  if (repoPayloads.length) {
    const result = await forwardAimsRuntimePost<IngestResult>(
      event,
      `/v1/aims/projects/${id}/gitlab-commits/ingest`,
      { uid, query: runtimeQuery, body: { repos: repoPayloads } }
    )
    synced = result.synced
  }

  return {
    code: 0,
    data: {
      message: `同步完成，共处理 ${synced} 条提交`,
      synced
    }
  }
})
