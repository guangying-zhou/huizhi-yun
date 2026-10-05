/**
 * 获取 GitLab 仓库提交列表
 * GET /api/v1/git-projects/:projectCode/commits
 *
 * 查询参数：
 *   since  — 起始时间（ISO 8601），默认最近30天
 *   until  — 结束时间（ISO 8601）
 *   ref    — 分支名，默认 default_branch
 *   page   — 页码，默认 1
 *   per_page — 每页条数，默认 50，最大 100
 *
 * 认证：Bearer API Key（供其他模块调用）
 */
import type { RowDataPacket } from 'mysql2/promise'
import { verifyApiKey } from '~~/server/utils/api-auth'

interface GitProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface GitLabCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  authored_date: string
  committed_date: string
  web_url: string
  stats?: { additions: number, deletions: number, total: number }
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const query = getQuery(event)
  const projectCode = typeof query.project_code === 'string' ? query.project_code : ''
  if (!projectCode) {
    throw createError({ statusCode: 400, message: '缺少 project_code 参数' })
  }

  const pool = useDbPool()
  const [rows] = await pool.query<GitProjectRow[]>(
    'SELECT id, project_code, repo_url FROM git_projects WHERE project_code = ? LIMIT 1',
    [projectCode]
  )

  const project = rows[0]
  if (!project || !project.repo_url) {
    throw createError({ statusCode: 404, message: '项目不存在或未关联仓库' })
  }

  const config = useRuntimeConfig()
  const gitlabBaseUrl = config.ingestionService.gitlabBaseUrl
  const gitlabToken = config.ingestionService.gitlabApiToken

  if (!gitlabToken) {
    throw createError({ statusCode: 500, message: 'GitLab API Token 未配置' })
  }

  // 从 repo_url 提取 GitLab 项目路径
  // 兼容 http/https 差异：用正则去掉协议+域名
  const repoPath = project.repo_url
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/\.git$/, '')

  if (!repoPath) {
    throw createError({ statusCode: 500, message: `无法从 repo_url 提取路径: ${project.repo_url}` })
  }

  const encodedPath = encodeURIComponent(repoPath)

  // 读取查询参数
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.per_page) || 50))
  const refName = typeof query.ref === 'string' ? query.ref : undefined
  const since = typeof query.since === 'string' ? query.since : undefined
  const until = typeof query.until === 'string' ? query.until : undefined

  // 构造 GitLab API 参数
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('per_page', String(perPage))
  params.set('with_stats', 'true')
  if (refName) params.set('ref_name', refName)
  if (since) params.set('since', since)
  if (until) params.set('until', until)

  try {
    const commits = await $fetch<GitLabCommit[]>(
      `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/commits?${params.toString()}`,
      {
        headers: { 'PRIVATE-TOKEN': gitlabToken },
        timeout: 15000
      }
    )

    return {
      code: 0,
      data: commits.map(c => ({
        sha: c.id,
        shortSha: c.short_id,
        title: c.title,
        message: c.message,
        authorName: c.author_name,
        authorEmail: c.author_email,
        authoredDate: c.authored_date,
        committedDate: c.committed_date,
        webUrl: c.web_url,
        additions: c.stats?.additions ?? null,
        deletions: c.stats?.deletions ?? null,
        total: c.stats?.total ?? null
      }))
    }
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 404) {
      throw createError({ statusCode: 404, message: `GitLab 仓库 ${repoPath} 不存在` })
    }
    throw createError({
      statusCode: 502,
      message: `GitLab API 调用失败: ${(err as Error).message || '未知错误'}`
    })
  }
})
