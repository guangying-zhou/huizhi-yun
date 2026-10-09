/**
 * 获取 GitLab 提交的 diff 信息
 * GET /api/v1/git-projects/commit-diff?project_code=xxx&sha=xxx
 *
 * 认证：Bearer API Key
 */
import type { RowDataPacket } from 'mysql2/promise'
import { verifyApiKey } from '~~/server/utils/api-auth'

interface GitProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface GitLabDiff {
  old_path: string
  new_path: string
  a_mode: string
  b_mode: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const query = getQuery(event)
  const projectCode = typeof query.project_code === 'string' ? query.project_code : ''
  const sha = typeof query.sha === 'string' ? query.sha : ''

  if (!projectCode || !sha) {
    throw createError({ statusCode: 400, message: '缺少 project_code 或 sha 参数' })
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

  // 兼容 http/https 差异
  const repoPath = project.repo_url
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/\.git$/, '')

  if (!repoPath) {
    throw createError({ statusCode: 500, message: `无法从 repo_url 提取路径: ${project.repo_url}` })
  }

  const encodedPath = encodeURIComponent(repoPath)

  try {
    const diffs = await $fetch<GitLabDiff[]>(
      `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/commits/${sha}/diff`,
      {
        headers: { 'PRIVATE-TOKEN': gitlabToken },
        timeout: 15000
      }
    )

    return {
      code: 0,
      data: diffs.map(d => ({
        oldPath: d.old_path,
        newPath: d.new_path,
        newFile: d.new_file,
        renamedFile: d.renamed_file,
        deletedFile: d.deleted_file,
        diff: d.diff
      }))
    }
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 404) {
      throw createError({ statusCode: 404, message: '提交不存在' })
    }
    throw createError({
      statusCode: 502,
      message: `GitLab API 调用失败: ${(err as Error).message || '未知错误'}`
    })
  }
})
