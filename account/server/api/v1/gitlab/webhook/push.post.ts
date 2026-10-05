import { useDbPool } from '~~/server/utils/db'
import { useOSS } from '~~/server/utils/oss'
import type { RowDataPacket } from 'mysql2/promise'
import { createTwoFilesPatch } from 'diff'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface GitLabWebhookPayload {
  object_kind: string
  project: {
    id: number
    web_url: string
    path_with_namespace: string
  }
  commits: Array<{
    id: string
    message: string
    timestamp: string
    author: {
      name: string
      email: string
    }
    added: string[]
    modified: string[]
    removed: string[]
  }>
  repository: {
    url: string
  }
}

interface GitLabFileResponse {
  file_name: string
  file_path: string
  size: number
  encoding: string
  content: string
}

interface GitLabCommit {
  id: string
  created_at: string
  author_name: string
  author_email: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<GitLabWebhookPayload>(event)
  const pool = useDbPool()

  console.log('[GitLab Webhook] Received push event')

  if (body.object_kind !== 'push' || !body.commits || body.commits.length === 0) {
    return { code: 0, message: 'Ignored' }
  }

  try {
    const [projectRows] = await pool.query<ProjectRow[]>(
      'SELECT id, project_code, repo_url FROM git_projects WHERE repo_url LIKE ?',
      [`%${body.project.path_with_namespace}%`]
    ) as [ProjectRow[], unknown]

    if (projectRows.length === 0 || !projectRows[0]) {
      return { code: 0, message: 'Project not found' }
    }

    const project = projectRows[0]
    const gitlabProjectPath = extractGitLabProjectPath(project.repo_url!)

    if (!gitlabProjectPath) {
      throw createError({ statusCode: 400, message: 'Invalid repo_url' })
    }

    const changedMarkdownFiles = new Set<string>()
    for (const commit of body.commits) {
      const files = [...(commit.added || []), ...(commit.modified || [])]
      files.forEach((file) => {
        if (file === 'README.md' || (file.startsWith('docs/') && file.endsWith('.md'))) {
          changedMarkdownFiles.add(file)
        }
      })
    }

    if (changedMarkdownFiles.size === 0) {
      return { code: 0, message: 'No markdown files changed' }
    }

    const gitlabBaseUrl = process.env.GITLAB_BASE_URL
    const gitlabToken = process.env.GITLAB_BOT_TOKEN

    if (!gitlabBaseUrl || !gitlabToken) {
      throw createError({ statusCode: 500, message: 'GitLab config missing' })
    }

    const encodedPath = encodeURIComponent(gitlabProjectPath)
    const ossClient = useOSS()
    let updated = 0, conflicts = 0

    for (const filePath of changedMarkdownFiles) {
      try {
        const ossPath = `${gitlabProjectPath}/${filePath}`

        const fileCommitsUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/commits?path=${encodeURIComponent(filePath)}&per_page=1`
        const fileCommits = await $fetch<GitLabCommit[]>(fileCommitsUrl, {
          headers: { 'PRIVATE-TOKEN': gitlabToken }
        })

        if (!fileCommits || fileCommits.length === 0) continue

        const latestCommit = fileCommits[0]!
        const gitlabLatestCommitId = latestCommit.id

        const fileInfoUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(filePath)}`
        const fileInfo = await $fetch<GitLabFileResponse>(fileInfoUrl, {
          headers: { 'PRIVATE-TOKEN': gitlabToken }
        })

        const gitlabContent = Buffer.from(fileInfo.content, fileInfo.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8')
        const gitlabContentSize = Buffer.byteLength(gitlabContent, 'utf-8')

        try {
          const ossFile = await ossClient.head(ossPath)
          const ossMeta = ossFile.meta as Record<string, string> | undefined
          const ossCommitId = ossMeta?.['gitlab-commit-id']
          const savedLastModified = ossMeta?.['synced-last-modified']
          const headers = ossFile.res.headers as Record<string, string>
          const currentOssLastModified = headers['last-modified']

          // 如果commit_id相同，跳过
          if (ossCommitId === gitlabLatestCommitId) continue

          // 判断OSS是否被用户修改（对比保存的lastModified和当前的lastModified）
          const ossWasModified = savedLastModified && savedLastModified !== currentOssLastModified

          if (!ossWasModified) {
            // OSS未被修改，自动更新
            const buffer = Buffer.from(gitlabContent, 'utf-8')
            await ossClient.put(ossPath, buffer, {
              headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
            })

            // 获取上传后的lastModified
            const updatedFile = await ossClient.head(ossPath)
            const updatedHeaders = updatedFile.res.headers as Record<string, string>
            const newLastModified = updatedHeaders['last-modified']

            await ossClient.putMeta(ossPath, {
              'gitlab-commit-id': gitlabLatestCommitId,
              'gitlab-latest-commit-id': gitlabLatestCommitId,
              'gitlab-latest-size': gitlabContentSize.toString(),
              'synced-last-modified': newLastModified || '',
              'synced-at': new Date().toISOString(),
              'conflict-status': '0',
              'uid': 0,
              'pid': 0
            }, {})

            updated++
            console.log(`[GitLab Webhook] Auto updated ${filePath}`)
          } else {
            // OSS被修改 + GitLab有更新 = 冲突
            const ossFileContent = await ossClient.get(ossPath)
            const ossContent = ossFileContent.content.toString('utf-8')

            const diff = createTwoFilesPatch(
              `GitLab: ${filePath}`,
              `OSS: ${filePath}`,
              gitlabContent,
              ossContent,
              'GitLab version',
              'OSS version'
            )

            const tempPath = `${gitlabProjectPath}/temp/${filePath}`
            await ossClient.put(tempPath, Buffer.from(gitlabContent, 'utf-8'), {
              headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
            })

            const diffPath = `${tempPath}.diff`
            await ossClient.put(diffPath, Buffer.from(diff, 'utf-8'), {
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            })

            // 更新OSS主文件元数据（保存两个commit_id）
            await ossClient.putMeta(ossPath, {
              'gitlab-commit-id': ossCommitId || '', // OSS基于的版本（不变）
              'gitlab-latest-commit-id': gitlabLatestCommitId, // GitLab最新版本
              'gitlab-latest-size': gitlabContentSize.toString(),
              'synced-last-modified': currentOssLastModified || '', // 保持当前值
              'synced-at': new Date().toISOString(),
              'conflict-status': '1', // 标记冲突
              'uid': 0,
              'pid': 0
            }, {})

            conflicts++
            console.log(`[GitLab Webhook] Conflict detected for ${filePath}`)
          }
        } catch (err: unknown) {
          const error = err as { code?: string, status?: number }
          if (error.code === 'NoSuchKey' || error.status === 404) {
            // 新文件
            const buffer = Buffer.from(gitlabContent, 'utf-8')
            await ossClient.put(ossPath, buffer, {
              headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
            })

            // 获取上传后的lastModified
            const uploadedFile = await ossClient.head(ossPath)
            const uploadedHeaders = uploadedFile.res.headers as Record<string, string>
            const newLastModified = uploadedHeaders['last-modified']

            await ossClient.putMeta(ossPath, {
              'gitlab-commit-id': gitlabLatestCommitId,
              'gitlab-latest-commit-id': gitlabLatestCommitId,
              'gitlab-latest-size': gitlabContentSize.toString(),
              'synced-last-modified': newLastModified || '',
              'synced-at': new Date().toISOString(),
              'conflict-status': '0',
              'uid': 0,
              'pid': 0
            }, {})

            updated++
            console.log(`[GitLab Webhook] Created new file ${filePath}`)
          }
        }
      } catch (err: unknown) {
        console.error(`[Webhook] Error processing ${filePath}:`, err)
      }
    }

    return {
      code: 0,
      data: { total: changedMarkdownFiles.size, updated, conflicts }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number }
    console.error('[Webhook] Error:', error)
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, message: 'Webhook processing failed' })
  }
})

function extractGitLabProjectPath(repoUrl: string): string | null {
  try {
    const url = repoUrl.replace(/\.git$/, '')
    const match = url.match(/[^/]+\.[^/]+\/(.+)$/)
    return match?.[1] || null
  } catch {
    return null
  }
}
