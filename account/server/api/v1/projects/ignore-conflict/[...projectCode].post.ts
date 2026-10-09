import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { useProjectsOSS } from '~~/server/utils/oss'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '忽略文档冲突',
    description: '保留 OSS 当前版本，忽略此次 GitLab 更新。需要 API Key 认证。',
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

interface IgnoreConflictRequest {
  uid: string
  oss_path: string
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const body = await readBody<IgnoreConflictRequest>(event)
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

    const project = projectRows[0]
    const ossClient = useProjectsOSS()

    // 2. Get current file metadata
    const ossFile = await ossClient.head(body.oss_path)
    const ossMeta = ossFile.meta as Record<string, string> | undefined

    if (!ossMeta) {
      throw createError({
        statusCode: 404,
        message: 'File metadata not found'
      })
    }

    const gitlabCommitId = ossMeta['gitlab-commit-id']
    const gitlabLatestCommitId = ossMeta['gitlab-latest-commit-id']
    const headers = ossFile.res.headers as Record<string, string>
    const currentOssLastModified = headers['last-modified']

    // 3. 更新元数据：将gitlab-commit-id设置为latest，标记为已忽略
    await ossClient.putMeta(body.oss_path, {
      'gitlab-commit-id': gitlabLatestCommitId || gitlabCommitId || '', // 更新为最新版本
      'gitlab-latest-commit-id': gitlabLatestCommitId || gitlabCommitId || '',
      'gitlab-latest-size': ossMeta['gitlab-latest-size'] || '0',
      'synced-last-modified': currentOssLastModified || '', // 保存当前的lastModified
      'synced-at': new Date().toISOString(),
      'conflict-status': '0', // 标记为已处理
      'uid': 0,
      'pid': 0
    }, {})

    // 4. Delete temp files if they exist
    try {
      // Extract relative path to find temp file
      const gitlabProjectPath = extractGitLabProjectPath(project.repo_url || '')
      if (!gitlabProjectPath) throw new Error('Invalid repo_url')

      const tempPath = body.oss_path.includes(`/${gitlabProjectPath}/`)
        ? body.oss_path.replace(`/${gitlabProjectPath}/`, `/${gitlabProjectPath}/temp/`)
        : body.oss_path.replace(`${gitlabProjectPath}/`, `${gitlabProjectPath}/temp/`)

      // Delete temp file
      await ossClient.delete(tempPath)
      console.log(`[Ignore Conflict] Deleted temp file: ${tempPath}`)

      // Delete diff file
      const diffPath = `${tempPath}.diff`
      await ossClient.delete(diffPath)
      console.log(`[Ignore Conflict] Deleted diff file: ${diffPath}`)
    } catch (err: unknown) {
      const error = err as Error
      // Temp files might not exist, just log
      console.warn('[Ignore Conflict] Failed to delete temp files:', error.message)
    }

    console.log(`[Ignore Conflict] Conflict ignored for: ${body.oss_path}`)

    return {
      code: 0,
      message: 'Conflict ignored successfully',
      data: {
        oss_path: body.oss_path,
        conflict_status: '0'
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('[Ignore Conflict] Failed:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to ignore conflict'
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
