/**
 * 获取 GitLab 仓库中 docs/ 目录和根目录下的 Markdown 文件清单（用于文档选择器）
 * GET /api/v1/projects/:projectCode/docs-tree?ref=<分支名或 commit_id>
 *
 * 返回：{ files: [{ path, name, size }], ref, default_branch, head_commit_id }
 */
import type { RowDataPacket } from 'mysql2/promise'
import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { extractGitLabProjectPath, getDefaultBranch, gitlabFetch } from '~~/server/utils/gitlab'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '列出仓库中的 Markdown 文档',
    description: '返回项目 GitLab 仓库根目录及 docs/ 目录下的 .md 文件清单。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'ref', required: false, schema: { type: 'string' }, description: '分支名或 commit_id，默认使用仓库默认分支' }
    ]
  }
})

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface GitLabTreeItem {
  id: string
  name: string
  type: 'blob' | 'tree'
  path: string
  mode: string
}

interface GitLabCommit {
  id: string
  short_id: string
  committed_date: string
}

const isTargetMarkdownPath = (path: string): boolean => {
  const p = path.toLowerCase()
  if (!p.endsWith('.md')) return false
  const isRootMarkdown = !path.includes('/')
  const isInDocs = /^docs\//i.test(path)
  return isRootMarkdown || isInDocs
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  if (!projectCode) {
    throw createError({ statusCode: 400, message: 'projectCode 必填' })
  }

  const query = getQuery(event)
  const refParam = typeof query.ref === 'string' ? query.ref : ''

  const pool = useDbPool()
  const [rows] = await pool.query<ProjectRow[]>(
    'SELECT id, project_code, repo_url FROM git_projects WHERE project_code = ?',
    [projectCode]
  )
  if (!rows.length || !rows[0]) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }
  const project = rows[0]
  if (!project.repo_url) {
    throw createError({ statusCode: 400, message: '项目未配置 repo_url' })
  }

  const gitlabPath = extractGitLabProjectPath(project.repo_url)
  if (!gitlabPath) {
    throw createError({ statusCode: 400, message: 'repo_url 格式不正确' })
  }

  const encodedPath = encodeURIComponent(gitlabPath)
  const defaultBranch = await getDefaultBranch(encodedPath)
  const ref = refParam || defaultBranch

  // 拉取 head commit id（便于前端在跟随/快照切换时记录）
  let headCommitId = ''
  try {
    const commits = await gitlabFetch<GitLabCommit[]>(
      `/api/v4/projects/${encodedPath}/repository/commits?ref_name=${encodeURIComponent(ref)}&per_page=1`
    )
    if (commits.length && commits[0]) headCommitId = commits[0].id
  } catch {
    // 允许失败，不阻断树列表
  }

  // 拉取文件树，翻页直到完整
  let allFiles: GitLabTreeItem[] = []
  let page = 1
  while (page <= 20) {
    const response = await gitlabFetch<GitLabTreeItem[]>(
      `/api/v4/projects/${encodedPath}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(ref)}&page=${page}`
    )
    if (!response.length) break
    allFiles = allFiles.concat(response)
    if (response.length < 100) break
    page++
  }

  const files = allFiles
    .filter(f => f.type === 'blob' && isTargetMarkdownPath(f.path))
    .map(f => ({
      path: f.path,
      name: f.name,
      blob_id: f.id
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    code: 0,
    data: {
      files,
      ref,
      default_branch: defaultBranch,
      head_commit_id: headCommitId,
      project_code: project.project_code,
      repo_url: project.repo_url
    }
  }
})
