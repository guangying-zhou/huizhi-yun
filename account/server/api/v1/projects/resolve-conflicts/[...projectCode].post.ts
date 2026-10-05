import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { useProjectsOSS } from '~~/server/utils/oss'
import type { RowDataPacket } from 'mysql2/promise'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface DocItem {
  oss_path: string
  use_gitlab?: boolean
  delete?: boolean
}

interface ResponseDocItem {
  oss_path: string
  use_gitlab?: boolean
  delete?: boolean
  content_size?: number
}

interface RequestBody {
  uid: string
  docs: DocItem[]
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const body = await readBody<RequestBody>(event)
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
    // Get project info
    const [projectRows] = await pool.query<ProjectRow[]>(
      'SELECT id, project_code, repo_url FROM git_projects WHERE project_code = ?',
      [projectCode]
    )

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

    if (!gitlabProjectPath) {
      throw createError({
        statusCode: 400,
        message: 'Invalid repo_url format'
      })
    }

    const ossClient = useProjectsOSS()

    // Process each document and collect results
    const processedDocs: ResponseDocItem[] = []

    for (const doc of body.docs) {
      try {
        if (doc.delete) {
          // Delete the file from OSS
          await ossClient.delete(doc.oss_path)
          console.log(`[Resolve Conflicts] Deleted: ${doc.oss_path}`)

          processedDocs.push({
            oss_path: doc.oss_path,
            delete: true
          })
        } else if (doc.use_gitlab !== undefined) {
          // Extract relative path to find temp file
          // e.g. huizhi-yun/account/docs/README.md -> huizhi-yun/account/temp/docs/README.md
          const tempPath = doc.oss_path.includes(`/${gitlabProjectPath}/`)
            ? doc.oss_path.replace(`/${gitlabProjectPath}/`, `/${gitlabProjectPath}/temp/`)
            : doc.oss_path.replace(`${gitlabProjectPath}/`, `${gitlabProjectPath}/temp/`)

          if (doc.use_gitlab) {
            // Use GitLab version: move temp file to main location
            try {
              // Get temp file info to get content size and metadata
              const tempFileInfo = await ossClient.head(tempPath)
              const contentSize = tempFileInfo.res.size || 0

              // Copy temp file to main location (this preserves metadata)
              await ossClient.copy(doc.oss_path, tempPath)
              // Delete temp file
              await ossClient.delete(tempPath)
              console.log(`[Resolve Conflicts] Used GitLab version: ${doc.oss_path}`)

              processedDocs.push({
                oss_path: doc.oss_path,
                use_gitlab: true,
                content_size: contentSize
              })
            } catch (err: unknown) {
              const error = err as Error
              console.error(`Failed to use GitLab version for ${doc.oss_path}:`, error)
              throw createError({
                statusCode: 500,
                message: `Failed to use GitLab version for ${doc.oss_path}: ${error.message}`
              })
            }
          } else {
            // Use OSS version: just delete temp file
            try {
              await ossClient.delete(tempPath)
              console.log(`[Resolve Conflicts] Used OSS version: ${doc.oss_path}`)

              processedDocs.push({
                oss_path: doc.oss_path,
                use_gitlab: false
              })
            } catch (err: unknown) {
              const error = err as Error
              // Temp file might not exist, just log and continue
              console.warn(`Failed to delete temp file ${tempPath}:`, error.message)

              processedDocs.push({
                oss_path: doc.oss_path,
                use_gitlab: false
              })
            }
          }
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(`Failed to process doc ${doc.oss_path}:`, error)
        throw createError({
          statusCode: 500,
          message: `Failed to process doc ${doc.oss_path}: ${error.message}`
        })
      }
    }

    return {
      code: 0,
      message: 'success',
      data: {
        docs: processedDocs
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to resolve conflicts:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to resolve conflicts'
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
