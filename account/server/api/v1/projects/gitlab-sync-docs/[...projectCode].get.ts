import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { useProjectsOSS } from '~~/server/utils/oss'
import { createTwoFilesPatch } from 'diff'
import type { Pool, RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '同步 GitLab 文档到 OSS',
    description: '将项目仓库根目录下所有 Markdown 文件，以及 docs（大小写不敏感）目录下的 Markdown 文件同步到 OSS。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' }, description: '项目编码' }
    ]
  }
})

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
}

interface UserRow extends RowDataPacket {
  uid: string
  email: string
}

interface GitLabTreeItem {
  id: string
  name: string
  type: 'blob' | 'tree'
  path: string
  mode: string
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

interface GitLabCommit {
  id: string
  short_id: string
  created_at: string
  author_name: string
  author_email: string
  title: string
  message: string
}

interface NewFileItem {
  doc_path: string
  oss_path: string
  content_size: number
  gitlab_commit_id: string
  gitlab_commit_time: string
  gitlab_committer: string
}

interface NoChangeFileItem {
  doc_path: string
  oss_path: string
}

interface UpdatedFileItem {
  doc_path: string
  oss_path: string
  content_size: number
  gitlab_commit_id: string
  gitlab_commit_time: string
  gitlab_committer: string
}

interface ConflictFileItem {
  doc_path: string
  oss_path: string
  content_size: number
  gitlab_commit_id: string
  gitlab_commit_time: string
  gitlab_committer: string
  diff: string
}

interface DeletedFileItem {
  oss_path: string
  gitlab_commit_id: string
  gitlab_commit_time: string
  gitlab_committer: string
}

// Helper function to get uid from email
async function getUidFromEmail(email: string, pool: Pool): Promise<string> {
  try {
    const [userRows] = await pool.query(
      'SELECT uid FROM system_users WHERE email = ?',
      [email]
    ) as [UserRow[], unknown]

    if (userRows && userRows.length > 0 && userRows[0]) {
      return userRows[0].uid
    }
  } catch (error) {
    console.warn(`Failed to get uid for email ${email}:`, error)
  }

  // Fallback: extract uid from email (before @)
  return email.split('@')[0] || email
}

const isTargetMarkdownPath = (path: string): boolean => {
  const normalized = path.toLowerCase()
  if (!normalized.endsWith('.md')) {
    return false
  }

  const isRootMarkdown = !path.includes('/')
  const isInDocs = /^docs\//i.test(path)

  return isRootMarkdown || isInDocs
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const pool = useDbPool()

  try {
    // 1. Get project and repo_url
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
    // e.g., http://gitlab.wiztek.cn/group/project.git -> group/project
    const gitlabProjectPath = extractGitLabProjectPath(project.repo_url)

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
    } catch (err: unknown) {
      const error = err as Error
      console.error('Failed to get project info, using default branch "main":', error.message)
    }

    // 3. Fetch repository tree to find markdown files
    const treeUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/tree?recursive=true&per_page=100&ref=${defaultBranch}`

    let allFiles: GitLabTreeItem[] = []
    let page = 1
    let hasMore = true

    // Fetch all pages
    while (hasMore) {
      const pagedUrl = `${treeUrl}&page=${page}`
      const treeResponse = await $fetch<GitLabTreeItem[]>(pagedUrl, {
        headers: {
          'PRIVATE-TOKEN': gitlabToken
        }
      })

      if (treeResponse.length === 0) {
        hasMore = false
      } else {
        allFiles = allFiles.concat(treeResponse)
        page++
        // Safety limit to avoid infinite loops
        if (page > 10) {
          console.warn('[GitLab Sync] Reached page limit, stopping pagination')
          hasMore = false
        }
      }
    }

    console.log('[GitLab Sync] Total items fetched:', allFiles.length)
    console.log('[GitLab Sync] Blob items:', allFiles.filter(f => f.type === 'blob').length)
    console.log('[GitLab Sync] Tree items:', allFiles.filter(f => f.type === 'tree').length)

    // 4. Filter markdown files (all root .md files + docs directory .md files, case-insensitive for docs)
    const markdownFiles = allFiles.filter((item) => {
      if (item.type !== 'blob') return false

      const match = isTargetMarkdownPath(item.path)
      if (match) {
        console.log('[GitLab Sync] Matched file:', item.path)
      }

      return match
    })

    console.log('[GitLab Sync] Markdown files found:', markdownFiles.length)
    console.log('[GitLab Sync] Files:', markdownFiles.map(f => f.path).join(', '))

    // 5. Get repository's latest commit
    const repoCommitsUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/commits?per_page=1&ref_name=${defaultBranch}`
    const repoCommits = await $fetch<GitLabCommit[]>(repoCommitsUrl, {
      headers: {
        'PRIVATE-TOKEN': gitlabToken
      }
    })

    if (!repoCommits || repoCommits.length === 0) {
      console.error('No commits found for repository')
      throw createError({
        statusCode: 500,
        message: 'No commits found for repository'
      })
    }

    const repoLatestCommit = repoCommits[0]

    // Get uid for repo latest commit
    const repoCommitterUid = await getUidFromEmail(repoLatestCommit!.author_email, pool)

    // 6. Process files: check OSS and handle conflicts
    const ossClient = useProjectsOSS()
    const newFiles: NewFileItem[] = []
    const noChangeFiles: NoChangeFileItem[] = []
    const updatedFiles: UpdatedFileItem[] = []
    const conflictFiles: ConflictFileItem[] = []

    // Track GitLab files for later comparison
    const gitlabFilePaths = new Set(markdownFiles.map(f => f.path))

    for (const file of markdownFiles) {
      const ossPath = `${gitlabProjectPath}/${file.path}`

      console.log(`[GitLab Sync] Processing file: ${file.path} -> ${ossPath}`)

      try {
        // Get file's latest commit first (lightweight operation)
        const fileCommitsUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/commits?path=${encodeURIComponent(file.path)}&per_page=1&ref_name=${defaultBranch}`
        const fileCommits = await $fetch<GitLabCommit[]>(fileCommitsUrl, {
          headers: {
            'PRIVATE-TOKEN': gitlabToken
          }
        })

        if (!fileCommits || fileCommits.length === 0) {
          console.error(`No commits found for file: ${file.path}`)
          continue
        }

        const latestCommit = fileCommits[0]
        const gitlabCommitId = latestCommit!.id

        // Get uid from email
        const committerUid = await getUidFromEmail(latestCommit!.author_email, pool)

        console.log(`[GitLab Sync] Commit info for ${file.path}:`)
        console.log(`  commit_id: ${gitlabCommitId}`)
        console.log(`  author_name: ${latestCommit!.author_name}`)
        console.log(`  author_email: ${latestCommit!.author_email}`)
        console.log(`  mapped uid: ${committerUid}`)

        try {
          // Check if file exists in OSS and get metadata
          const ossFile = await ossClient.head(ossPath)
          const ossMeta = ossFile.meta as Record<string, string> | undefined
          const ossCommitId = ossMeta?.['gitlab-commit-id']
          const savedLastModified = ossMeta?.['synced-last-modified']

          // Get current OSS lastModified from headers
          const headers = ossFile.res.headers as Record<string, string>
          const currentOssLastModified = headers['last-modified']

          console.log(`[GitLab Sync] OSS metadata for ${file.path}:`)
          console.log(`  oss commit_id: ${ossCommitId || 'none'}`)
          console.log(`  synced lastModified: ${savedLastModified || 'none'}`)
          console.log(`  current lastModified: ${currentOssLastModified}`)
          console.log(`  oss modified: ${savedLastModified !== currentOssLastModified}`)

          // Logic 2: commit_id matches - no change
          // 即使OSS被修改，只要GitLab版本未变，就不视为冲突
          if (ossCommitId && ossCommitId === gitlabCommitId) {
            noChangeFiles.push({
              doc_path: file.path,
              oss_path: ossPath
            })
            console.log(`[GitLab Sync] File unchanged (commit_id match, ignoring OSS edits): ${file.path}`)
          } else {
            // Logic 3: commit_id different - GitLab has updates
            // 只有在GitLab有更新时，才检查OSS是否被修改以决定是否冲突

            // Check if OSS file was modified by comparing lastModified
            const ossWasModified = savedLastModified && savedLastModified !== currentOssLastModified

            // Fetch file content from GitLab
            const fileInfoUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(file.path)}?ref=${defaultBranch}`
            const fileInfo = await $fetch<GitLabFileResponse>(fileInfoUrl, {
              headers: {
                'PRIVATE-TOKEN': gitlabToken
              }
            })

            const gitlabContent = Buffer.from(fileInfo.content, fileInfo.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8')
            const gitlabContentSize = Buffer.byteLength(gitlabContent, 'utf-8')

            if (!ossWasModified) {
              // Logic 3a: OSS not modified - auto update
              const buffer = Buffer.from(gitlabContent, 'utf-8')
              await ossClient.put(ossPath, buffer, {
                headers: {
                  'Content-Type': 'text/markdown; charset=utf-8'
                }
              })

              // Get actual lastModified after upload
              const updatedFile = await ossClient.head(ossPath)
              const updatedHeaders = updatedFile.res.headers as Record<string, string>
              const newLastModified = updatedHeaders['last-modified']

              await ossClient.putMeta(ossPath, {
                'gitlab-commit-id': gitlabCommitId,
                'gitlab-latest-commit-id': gitlabCommitId,
                'gitlab-latest-size': gitlabContentSize.toString(),
                'synced-last-modified': newLastModified || '',
                'synced-at': new Date().toISOString(),
                'conflict-status': '0',
                'uid': 0,
                'pid': 0
              }, {})

              updatedFiles.push({
                doc_path: file.path,
                oss_path: ossPath,
                content_size: gitlabContentSize,
                gitlab_commit_id: latestCommit!.id,
                gitlab_commit_time: latestCommit!.created_at,
                gitlab_committer: committerUid
              })
              console.log(`[GitLab Sync] Auto updated (OSS not modified): ${file.path}`)
            } else {
              // Logic 3b: OSS was modified - conflict
              const fileInfoUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(file.path)}?ref=${defaultBranch}`
              const fileInfo = await $fetch<GitLabFileResponse>(fileInfoUrl, {
                headers: {
                  'PRIVATE-TOKEN': gitlabToken
                }
              })

              const gitlabContent = Buffer.from(fileInfo.content, fileInfo.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8')
              const gitlabContentSize = Buffer.byteLength(gitlabContent, 'utf-8')

              // Logic 3b: OSS was modified - conflict
              // Get OSS file content for diff
              const ossFileContent = await ossClient.get(ossPath)
              const ossContent = ossFileContent.content.toString('utf-8')

              // Generate diff (swap order so OSS uses +, GitLab uses -)
              const diff = createTwoFilesPatch(
                `GitLab: ${file.path}`,
                `OSS: ${file.path}`,
                gitlabContent,
                ossContent,
                'GitLab version',
                'OSS version'
              )

              // Store GitLab version in temp
              const tempPath = `${gitlabProjectPath}/temp/${file.path}`
              const gitlabBuffer = Buffer.from(gitlabContent, 'utf-8')
              await ossClient.put(tempPath, gitlabBuffer, {
                headers: {
                  'Content-Type': 'text/markdown; charset=utf-8'
                }
              })

              // Save diff file
              const diffPath = `${tempPath}.diff`
              await ossClient.put(diffPath, Buffer.from(diff, 'utf-8'), {
                headers: {
                  'Content-Type': 'text/plain; charset=utf-8'
                }
              })

              // Update OSS main file metadata (mark conflict)
              await ossClient.putMeta(ossPath, {
                'gitlab-commit-id': ossCommitId || '', // OSS基于的版本
                'gitlab-latest-commit-id': gitlabCommitId, // GitLab最新版本
                'gitlab-latest-size': gitlabContentSize.toString(),
                'synced-last-modified': savedLastModified || currentOssLastModified || '',
                'synced-at': new Date().toISOString(),
                'conflict-status': '1',
                'uid': 0,
                'pid': 0
              }, {})

              conflictFiles.push({
                doc_path: file.path,
                oss_path: ossPath,
                content_size: gitlabContentSize,
                gitlab_commit_id: latestCommit!.id,
                gitlab_commit_time: latestCommit!.created_at,
                gitlab_committer: committerUid,
                diff
              })
              console.log(`[GitLab Sync] Conflict detected (OSS was modified): ${file.path}`)
            }
          }
        } catch (err: unknown) {
          const error = err as { code?: string, status?: number }
          // Logic 1: File doesn't exist in OSS - new file
          if (error.code === 'NoSuchKey' || error.status === 404) {
            // Fetch file content from GitLab
            const fileInfoUrl = `${gitlabBaseUrl}/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(file.path)}?ref=${defaultBranch}`
            const fileInfo = await $fetch<GitLabFileResponse>(fileInfoUrl, {
              headers: {
                'PRIVATE-TOKEN': gitlabToken
              }
            })

            const gitlabContent = Buffer.from(fileInfo.content, fileInfo.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8')
            const gitlabContentSize = Buffer.byteLength(gitlabContent, 'utf-8')

            const buffer = Buffer.from(gitlabContent, 'utf-8')
            await ossClient.put(ossPath, buffer, {
              headers: {
                'Content-Type': 'text/markdown; charset=utf-8'
              }
            })

            // Get actual lastModified after upload
            const uploadedFile = await ossClient.head(ossPath)
            const uploadedHeaders = uploadedFile.res.headers as Record<string, string>
            const newLastModified = uploadedHeaders['last-modified']

            await ossClient.putMeta(ossPath, {
              'gitlab-commit-id': gitlabCommitId,
              'gitlab-latest-commit-id': gitlabCommitId,
              'gitlab-latest-size': gitlabContentSize.toString(),
              'synced-last-modified': newLastModified || '',
              'synced-at': new Date().toISOString(),
              'conflict-status': '0',
              'uid': 0,
              'pid': 0
            }, {})

            newFiles.push({
              doc_path: file.path,
              oss_path: ossPath,
              content_size: gitlabContentSize,
              gitlab_commit_id: latestCommit!.id,
              gitlab_commit_time: latestCommit!.created_at,
              gitlab_committer: committerUid
            })
            console.log(`[GitLab Sync] New file uploaded: ${file.path}`)
          } else {
            console.error(`Failed to check OSS file ${ossPath}:`, error)
          }
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(`Failed to fetch file ${file.path} from GitLab:`, error)
        // Continue with other files
      }
    }

    // 7. Logic 4: Check for deleted files in OSS (exist in OSS but not in GitLab)
    const deletedFiles: DeletedFileItem[] = []

    try {
      // List all markdown files in OSS project directory
      const ossPrefix = `${gitlabProjectPath}/`

      // Recursively list all files
      const listAllFiles = async (prefix: string): Promise<string[]> => {
        const files: string[] = []
        let marker: string | undefined

        do {
          const result = await ossClient.list({
            prefix,
            'max-keys': 1000,
            marker
          }, {})

          if (result.objects) {
            for (const obj of result.objects) {
              // Skip temp files and non-markdown files
              if (!obj.name.includes('/temp/')) {
                const relativePath = obj.name.replace(ossPrefix, '')
                if (isTargetMarkdownPath(relativePath)) {
                  files.push(obj.name)
                }
              }
            }
          }

          marker = result.isTruncated ? result.nextMarker : undefined
        } while (marker)

        return files
      }

      const ossFiles = await listAllFiles(ossPrefix)

      for (const ossFilePath of ossFiles) {
        // Extract relative path
        const relativePath = ossFilePath.replace(ossPrefix, '')

        // Check if this file exists in GitLab
        if (!gitlabFilePaths.has(relativePath)) {
          deletedFiles.push({
            oss_path: ossFilePath,
            gitlab_commit_id: repoLatestCommit!.id,
            gitlab_commit_time: repoLatestCommit!.created_at,
            gitlab_committer: repoCommitterUid
          })
          console.log(`[GitLab Sync] File deleted in GitLab: ${relativePath}`)
        }
      }
    } catch (err: unknown) {
      const error = err as Error
      console.error('Failed to list OSS files:', error)
    }

    // Update docs_synced_at timestamp
    await pool.query(
      'UPDATE git_projects SET docs_synced_at = NOW() WHERE project_code = ?',
      [projectCode]
    )

    return {
      code: 0,
      data: {
        new: newFiles,
        updated: updatedFiles,
        nochange: noChangeFiles,
        conflict: conflictFiles,
        deleted: deletedFiles
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to sync docs from GitLab:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to sync docs from GitLab'
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
