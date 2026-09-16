import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { useProjectsOSS } from '~~/server/utils/oss'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '提交文档到 GitLab',
    description: '将文档从 OSS 提交到 GitLab 仓库。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' }, description: '项目编码' }
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['uid', 'docs'],
            properties: {
              uid: { type: 'string', description: '提交用户 UID' },
              docs: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['oss_path', 'gitlab_path'],
                  properties: {
                    oss_path: { type: 'string' },
                    gitlab_path: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
})

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface DocItem {
  oss_path: string
  gitlab_path: string
}

interface SubmitRequestBody {
  uid: string
  docs: DocItem[]
}

interface UserRow extends RowDataPacket {
  uid: string
  real_name: string | null
  email: string | null
}

interface GitLabCommitAction {
  action: 'create' | 'update'
  file_path: string
  content: string
  encoding?: 'text' | 'base64'
}

// Unused interface removed

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const body = await readBody<SubmitRequestBody>(event)
  const pool = useDbPool()

  // Validation
  if (!body.uid) {
    throw createError({
      statusCode: 400,
      message: 'Missing required field: uid'
    })
  }

  if (!body.docs || !Array.isArray(body.docs) || body.docs.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'Missing or invalid docs array'
    })
  }

  try {
    console.log(`[GitLab Submit] Starting submission for project ${projectCode} by user ${body.uid}`)
    console.log(`[GitLab Submit] Docs count: ${body.docs.length}`)

    // 1. Get user information
    const [userRows] = await pool.query<UserRow[]>(
      'SELECT uid, real_name, email FROM system_users WHERE uid = ?',
      [body.uid]
    )

    if (userRows.length === 0 || !userRows[0]) {
      throw createError({
        statusCode: 404,
        message: 'User not found'
      })
    }

    const user = userRows[0]
    const authorName = user.real_name || user.uid
    const authorEmail = user.email || `${user.uid}@wiztek.cn`
    console.log(`[GitLab Submit] Author: ${authorName} <${authorEmail}>`)

    // 2. Get project and repo_url
    const [projectRows] = await pool.query<ProjectRow[]>(
      'SELECT id, project_code, repo_url FROM git_projects WHERE project_code = ?',
      [projectCode]
    )

    if (projectRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: 'Project not found'
      })
    }

    if (projectRows.length === 0 || !projectRows[0]) {
      throw createError({
        statusCode: 404,
        message: 'Project not found'
      })
    }

    const project = projectRows[0]

    if (!project.repo_url) {
      throw createError({
        statusCode: 400,
        message: 'Project repo_url is not configured'
      })
    }

    // Extract GitLab project path from repo_url
    const gitlabProjectPath = extractGitLabProjectPath(project.repo_url)
    console.log(`[GitLab Submit] Repo URL: ${project.repo_url}`)
    console.log(`[GitLab Submit] GitLab project path: ${gitlabProjectPath}`)

    if (!gitlabProjectPath) {
      throw createError({
        statusCode: 400,
        message: 'Invalid repo_url format'
      })
    }

    const gitlabBaseUrl = process.env.GITLAB_BASE_URL
    const gitlabToken = process.env.GITLAB_BOT_TOKEN

    if (!gitlabBaseUrl || !gitlabToken) {
      throw createError({
        statusCode: 500,
        message: 'GitLab configuration is missing'
      })
    }

    console.log(`[GitLab Submit] GitLab URL: ${gitlabBaseUrl}`)

    // 2. Get project info to determine default branch
    const encodedPath = encodeURIComponent(gitlabProjectPath)
    const projectInfoUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}`

    let defaultBranch = 'main'
    try {
      const projectInfo = await $fetch<{ default_branch: string }>(projectInfoUrl, {
        headers: {
          'PRIVATE-TOKEN': gitlabToken
        }
      })
      defaultBranch = projectInfo.default_branch || 'main'
      console.log(`[GitLab Submit] Default branch: ${defaultBranch}`)
    } catch (err: unknown) {
      const error = err as Error
      console.error('[GitLab Submit] Failed to get project info, using default branch "main":', error.message)
    }

    // 3. Fetch file contents from OSS
    const ossClient = useProjectsOSS()
    const actions: GitLabCommitAction[] = []

    for (const doc of body.docs) {
      try {
        console.log(`[GitLab Submit] Processing doc: ${doc.oss_path} -> ${doc.gitlab_path}`)

        // Get file from OSS
        const result = await ossClient.get(doc.oss_path)
        const content = result.content.toString('utf-8')
        console.log(`[GitLab Submit] OSS content size: ${content.length} bytes`)

        // Check if file exists in GitLab to determine action
        const fileCheckUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(doc.gitlab_path)}?ref=${defaultBranch}`

        let action: 'create' | 'update' = 'create'

        try {
          await $fetch(fileCheckUrl, {
            headers: {
              'PRIVATE-TOKEN': gitlabToken
            }
          })
          // File exists, use update
          action = 'update'
          console.log('[GitLab Submit] File exists, action: update')
        } catch (err: unknown) {
          const error = err as { status?: number }
          // File doesn't exist, use create
          if (error.status === 404) {
            action = 'create'
            console.log('[GitLab Submit] File not found, action: create')
          } else {
            throw error
          }
        }

        actions.push({
          action,
          file_path: doc.gitlab_path,
          content,
          encoding: 'text'
        })
      } catch (err: unknown) {
        const error = err as Error
        console.error(`[GitLab Submit] Failed to process doc ${doc.oss_path}:`, error)
        throw createError({
          statusCode: 500,
          message: `Failed to process doc ${doc.oss_path}: ${error.message}`
        })
      }
    }

    if (actions.length === 0) {
      throw createError({
        statusCode: 400,
        message: 'No valid documents to commit'
      })
    }

    // 4. Generate commit message
    const fileList = actions.map(a => a.file_path).join(', ')
    const commitMessage = `docs(bot): Update ${actions.length} file(s) from Codocs\n\nFiles: ${fileList}\n\nSubmitted by: ${authorName} (${body.uid})`

    // 5. Create commit in GitLab
    // 确保使用正确的 API endpoint
    const commitUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/commits`

    const commitPayload = {
      branch: defaultBranch,
      commit_message: commitMessage,
      actions,
      author_email: authorEmail,
      author_name: authorName
    }

    console.log(`[GitLab Submit] Commit URL: ${commitUrl}`)
    console.log(`[GitLab Submit] Commit message: ${commitMessage}`)
    console.log(`[GitLab Submit] Actions count: ${actions.length}`)
    console.log('[GitLab Submit] Commit payload:', JSON.stringify(commitPayload, null, 2))

    let commitResponse
    try {
      // 使用 ofetch 确保 POST 方法正确执行
      const { ofetch } = await import('ofetch')
      commitResponse = await ofetch(commitUrl, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': gitlabToken,
          'Content-Type': 'application/json'
        },
        body: commitPayload,
        parseResponse: JSON.parse
      })
    } catch (err: unknown) {
      const fetchError = err as { status?: number, statusCode?: number, data?: unknown }
      console.error('[GitLab Submit] Fetch error:', fetchError)
      console.error('[GitLab Submit] Fetch error status:', fetchError.status || fetchError.statusCode)
      console.error('[GitLab Submit] Fetch error data:', fetchError.data)
      throw fetchError
    }

    console.log('[GitLab Submit] GitLab Response:', JSON.stringify(commitResponse, null, 2))
    console.log('[GitLab Submit] Response type:', typeof commitResponse)
    console.log('[GitLab Submit] Is array:', Array.isArray(commitResponse))

    // GitLab Commits API 应该返回单个 commit 对象，不是数组
    // 如果返回数组说明可能调用了错误的 endpoint 或有其他问题
    let commit: { id?: string, short_id?: string, web_url?: string } | null = null
    if (Array.isArray(commitResponse)) {
      console.error('[GitLab Submit] WARNING: Received array instead of commit object!')
      console.error('[GitLab Submit] This suggests the POST request may have failed and returned a GET response')
      throw createError({
        statusCode: 500,
        message: 'GitLab API returned unexpected response format (array instead of commit object)'
      })
    } else {
      commit = commitResponse as { id?: string, short_id?: string, web_url?: string }
    }

    console.log(`[GitLab Submit] Commit successful! ID: ${commit?.id}, Short ID: ${commit?.short_id}`)

    // 检查是否真的成功
    if (!commit || (!commit.id && !commit.short_id)) {
      console.error('[GitLab Submit] WARNING: Commit response is invalid!')
      throw createError({
        statusCode: 500,
        message: 'GitLab commit response is invalid'
      })
    }

    // Update docs_committed_at timestamp
    await pool.query(
      'UPDATE git_projects SET docs_committed_at = NOW() WHERE project_code = ?',
      [projectCode]
    )

    return {
      code: 0,
      message: 'success',
      data: {
        revision: commit.short_id || commit.id,
        commitId: commit.id,
        webUrl: commit.web_url
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('[GitLab Submit] ERROR:', error)
    console.error('[GitLab Submit] Error stack:', (error as Error).stack)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to submit docs to GitLab'
    })
  }
})

function extractGitLabProjectPath(repoUrl: string): string | null {
  try {
    // Remove .git suffix if present
    const url = repoUrl.replace(/\.git$/, '')

    // Extract path from URL
    // e.g., http://gitlab.wiztek.cn/group/project -> group/project
    const match = url.match(/[^/]+\.[^/]+\/(.+)$/)

    if (match && match[1]) {
      return match[1]
    }

    return null
  } catch {
    return null
  }
}
