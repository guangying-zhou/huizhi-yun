/**
 * 获取仓库中指定 Markdown 文档的原始内容
 * GET /api/v1/projects/:projectCode/doc?path=docs/design.md&ref=main
 * 或指定 commit_id：GET ...?path=xxx&commit_id=abc123
 *
 * 返回：{ path, name, size, content (utf8 md 文本), commit_id, last_commit_id, ref }
 */
import type { RowDataPacket } from 'mysql2/promise'
import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { extractGitLabProjectPath, getDefaultBranch, gitlabFetch } from '~~/server/utils/gitlab'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '读取仓库中的 Markdown 文档内容',
    description: '按 path + ref/commit_id 返回 .md 文件原文。支持版本快照（commit_id）与最新（ref 指分支）两种模式。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'path', required: true, schema: { type: 'string' }, description: '文件相对路径（如 docs/design.md）' },
      { in: 'query', name: 'ref', required: false, schema: { type: 'string' }, description: '分支名，默认仓库默认分支' },
      { in: 'query', name: 'commit_id', required: false, schema: { type: 'string' }, description: 'commit_id 优先于 ref；用于版本快照' }
    ]
  }
})

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface GitLabFileResponse {
  file_name: string
  file_path: string
  size: number
  encoding: string
  content: string
  content_sha256: string
  ref: string
  blob_id: string
  commit_id: string
  last_commit_id: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  if (!projectCode) {
    throw createError({ statusCode: 400, message: 'projectCode 必填' })
  }

  const query = getQuery(event)
  const filePath = typeof query.path === 'string' ? query.path : ''
  const refParam = typeof query.ref === 'string' ? query.ref : ''
  const commitId = typeof query.commit_id === 'string' ? query.commit_id : ''

  if (!filePath) {
    throw createError({ statusCode: 400, message: '缺少 path 参数' })
  }
  if (!filePath.toLowerCase().endsWith('.md')) {
    throw createError({ statusCode: 400, message: '仅支持 Markdown 文件' })
  }

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
  const encodedFile = encodeURIComponent(filePath)
  const ref = commitId || refParam || await getDefaultBranch(encodedPath)

  let fileData: GitLabFileResponse
  try {
    fileData = await gitlabFetch<GitLabFileResponse>(
      `/api/v4/projects/${encodedPath}/repository/files/${encodedFile}?ref=${encodeURIComponent(ref)}`
    )
  } catch (err: unknown) {
    const e = err as { statusCode?: number, response?: { status?: number } }
    if (e.statusCode === 404 || e.response?.status === 404) {
      throw createError({ statusCode: 404, message: '文件不存在或未在指定版本中' })
    }
    throw createError({ statusCode: 502, message: '拉取 GitLab 文件失败' })
  }

  // GitLab 返回 base64 encoded content
  let content = ''
  if (fileData.encoding === 'base64') {
    content = Buffer.from(fileData.content, 'base64').toString('utf-8')
  } else {
    content = fileData.content
  }

  return {
    code: 0,
    data: {
      path: fileData.file_path,
      name: fileData.file_name,
      size: fileData.size,
      content,
      commit_id: fileData.commit_id,
      last_commit_id: fileData.last_commit_id,
      blob_id: fileData.blob_id,
      ref: fileData.ref
    }
  }
})
