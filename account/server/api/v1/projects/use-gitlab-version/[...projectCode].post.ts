import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { useProjectsOSS } from '~~/server/utils/oss'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '使用 GitLab 版本覆盖文档',
    description: '发生冲突时，用 GitLab 版本覆盖 OSS 当前版本。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' }, description: '项目编码' }
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['uid', 'oss_path'],
            properties: {
              uid: { type: 'string', description: '操作用户 UID' },
              oss_path: { type: 'string', description: 'OSS 文件路径' }
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

interface UseGitLabVersionRequest {
  uid: string
  oss_path: string
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const body = await readBody<UseGitLabVersionRequest>(event)
  const pool = useDbPool()

  if (!projectCode) {
    throw createError({
      statusCode: 400,
      message: 'Missing project_code'
    })
  }

  if (!body.oss_path) {
    throw createError({
      statusCode: 400,
      message: 'Missing oss_path'
    })
  }

  try {
    // 1. Get project info
    const [projectRows] = await pool.query<ProjectRow[]>(
      'SELECT id, project_code, repo_url FROM git_projects WHERE project_code = ?',
      [projectCode]
    ) as [ProjectRow[], unknown]

    if (projectRows.length === 0 || !projectRows[0]) {
      throw createError({
        statusCode: 404,
        message: 'Project not found'
      })
    }

    const ossClient = useProjectsOSS()

    // 2. Get temp file path
    // Extract GitLab project path from repo_url
    const gitlabProjectPath = extractGitLabProjectPath(projectRows[0].repo_url || '')
    if (!gitlabProjectPath) throw new Error('Invalid repo_url')

    const tempPath = body.oss_path.includes(`/${gitlabProjectPath}/`)
      ? body.oss_path.replace(`/${gitlabProjectPath}/`, `/${gitlabProjectPath}/temp/`)
      : body.oss_path.replace(`${gitlabProjectPath}/`, `${gitlabProjectPath}/temp/`)

    // 3. Get temp file info
    const tempFile = await ossClient.head(tempPath)
    const tempMeta = tempFile.meta as Record<string, string> | undefined
    const contentSize = tempFile.res.size || 0

    if (!tempMeta) {
      throw createError({
        statusCode: 404,
        message: 'Temp file not found or no metadata'
      })
    }

    const gitlabLatestCommitId = tempMeta['gitlab-latest-commit-id']

    // 4. Copy temp file to main location
    await ossClient.copy(body.oss_path, tempPath)
    console.log(`[Use GitLab Version] Copied ${tempPath} to ${body.oss_path}`)

    // 5. Get new file info and update metadata
    const newFile = await ossClient.head(body.oss_path)
    const newHeaders = newFile.res.headers as Record<string, string>
    const newLastModified = newHeaders['last-modified']

    await ossClient.putMeta(body.oss_path, {
      'gitlab-commit-id': gitlabLatestCommitId || '',
      'gitlab-latest-commit-id': gitlabLatestCommitId || '',
      'gitlab-latest-size': contentSize.toString(),
      'synced-last-modified': newLastModified || '',
      'synced-at': new Date().toISOString(),
      'conflict-status': '0',
      'uid': 0,
      'pid': 0
    }, {})

    // 6. Delete temp files
    try {
      await ossClient.delete(tempPath)
      console.log(`[Use GitLab Version] Deleted temp file: ${tempPath}`)

      const diffPath = `${tempPath}.diff`
      await ossClient.delete(diffPath)
      console.log(`[Use GitLab Version] Deleted diff file: ${diffPath}`)
    } catch (err: unknown) {
      const error = err as Error
      console.warn('[Use GitLab Version] Failed to delete temp files:', error.message)
    }

    console.log(`[Use GitLab Version] Used GitLab version for: ${body.oss_path}`)

    return {
      code: 0,
      message: 'success',
      data: {
        oss_path: body.oss_path,
        content_size: contentSize,
        conflict_status: '0'
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('[Use GitLab Version] Failed:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to use GitLab version'
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
