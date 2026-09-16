import { createTwoFilesPatch } from 'diff'
import {
  createGitCommit,
  extractGitProjectPath,
  getGitRepositoryFile,
  listGitCommits,
  listGitMarkdownTree,
  resolveGitCommitActions
} from '@hzy/foundation/server/utils/gitIntegration'
import { createProjectsOSSClient } from './oss'

export interface SyncFileItem {
  oss_path: string
  doc_path: string
  content_size?: number
  gitlab_commit_id?: string
  gitlab_commit_time?: string
  gitlab_committer?: string
  diff?: string
}

export interface GitlabSyncData {
  new: SyncFileItem[]
  updated: SyncFileItem[]
  nochange: SyncFileItem[]
  conflict: SyncFileItem[]
  deleted: SyncFileItem[]
}

export interface SubmitGitlabDocsInput {
  projectCode: string
  uid: string
  authorName: string
  authorEmail: string
  docs: { oss_path?: string, gitlab_path?: string }[]
}

function isTargetMarkdownPath(path: string) {
  const normalized = path.toLowerCase()
  return normalized.endsWith('.md') && (!path.includes('/') || /^docs\//i.test(path))
}

function getUidFromEmail(email: string) {
  return email.split('@')[0] || email
}

function getStatus(error: unknown) {
  return (error as { status?: number, statusCode?: number })?.status
    || (error as { statusCode?: number })?.statusCode
}

function getCode(error: unknown) {
  return (error as { code?: string })?.code
}

async function listAllOssFiles(client: ReturnType<typeof createProjectsOSSClient>, prefix: string) {
  const files: string[] = []
  let marker: string | undefined

  do {
    const result = await client.list({
      prefix,
      'max-keys': 1000,
      marker
    }, {})

    for (const object of result.objects || []) {
      if (!object.name.includes('/temp/')) {
        const relativePath = object.name.replace(prefix, '')
        if (isTargetMarkdownPath(relativePath)) {
          files.push(object.name)
        }
      }
    }

    marker = result.isTruncated ? result.nextMarker : undefined
  } while (marker)

  return files
}

export async function syncProjectDocsFromGitLab(projectCode: string): Promise<GitlabSyncData> {
  const tree = await listGitMarkdownTree({ projectCode })
  const repoPath = tree.repo_path
  const defaultBranch = tree.default_branch || tree.ref || 'main'
  const gitlabFilePaths = new Set(tree.files.map(file => file.path))
  const ossClient = createProjectsOSSClient()

  const repoCommits = await listGitCommits({ projectCode, ref: defaultBranch, perPage: 1 })
  const repoLatestCommit = repoCommits[0]
  if (!repoLatestCommit) {
    throw createError({ statusCode: 502, message: 'No commits found for repository' })
  }

  const result: GitlabSyncData = {
    new: [],
    updated: [],
    nochange: [],
    conflict: [],
    deleted: []
  }

  for (const file of tree.files) {
    const ossPath = `${repoPath}/${file.path}`

    try {
      const fileCommits = await listGitCommits({
        projectCode,
        ref: defaultBranch,
        path: file.path,
        perPage: 1
      })
      const latestCommit = fileCommits[0]
      if (!latestCommit) continue

      const gitlabCommitId = latestCommit.sha
      const gitlabCommitter = getUidFromEmail(latestCommit.authorEmail)

      try {
        const ossFile = await ossClient.head(ossPath)
        const ossMeta = (ossFile.meta || {}) as Record<string, string | undefined>
        const ossCommitId = ossMeta['gitlab-commit-id']
        const savedLastModified = ossMeta['synced-last-modified']
        const headers = ossFile.res.headers as Record<string, string>
        const currentLastModified = headers['last-modified']

        if (ossCommitId && ossCommitId === gitlabCommitId) {
          result.nochange.push({ doc_path: file.path, oss_path: ossPath })
          continue
        }

        const gitlabFile = await getGitRepositoryFile({
          projectCode,
          path: file.path,
          ref: defaultBranch
        })
        const gitlabContentSize = Buffer.byteLength(gitlabFile.content, 'utf-8')
        const ossWasModified = Boolean(savedLastModified && savedLastModified !== currentLastModified)

        if (!ossWasModified) {
          await ossClient.put(ossPath, Buffer.from(gitlabFile.content, 'utf-8'), {
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
          })
          const updatedFile = await ossClient.head(ossPath)
          const updatedHeaders = updatedFile.res.headers as Record<string, string>
          await ossClient.putMeta(ossPath, {
            'gitlab-commit-id': gitlabCommitId,
            'gitlab-latest-commit-id': gitlabCommitId,
            'gitlab-latest-size': String(gitlabContentSize),
            'synced-last-modified': updatedHeaders['last-modified'] || '',
            'synced-at': new Date().toISOString(),
            'conflict-status': '0',
            'uid': 0,
            'pid': 0
          }, {})
          result.updated.push({
            doc_path: file.path,
            oss_path: ossPath,
            content_size: gitlabContentSize,
            gitlab_commit_id: gitlabCommitId,
            gitlab_commit_time: latestCommit.committedDate,
            gitlab_committer: gitlabCommitter
          })
          continue
        }

        const ossFileContent = await ossClient.get(ossPath)
        const ossContent = ossFileContent.content.toString('utf-8')
        const diff = createTwoFilesPatch(
          `GitLab: ${file.path}`,
          `OSS: ${file.path}`,
          gitlabFile.content,
          ossContent,
          'GitLab version',
          'OSS version'
        )
        const tempPath = `${repoPath}/temp/${file.path}`
        await ossClient.put(tempPath, Buffer.from(gitlabFile.content, 'utf-8'), {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
        })
        await ossClient.put(`${tempPath}.diff`, Buffer.from(diff, 'utf-8'), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
        await ossClient.putMeta(ossPath, {
          'gitlab-commit-id': ossCommitId || '',
          'gitlab-latest-commit-id': gitlabCommitId,
          'gitlab-latest-size': String(gitlabContentSize),
          'synced-last-modified': savedLastModified || currentLastModified || '',
          'synced-at': new Date().toISOString(),
          'conflict-status': '1',
          'uid': 0,
          'pid': 0
        }, {})
        result.conflict.push({
          doc_path: file.path,
          oss_path: ossPath,
          content_size: gitlabContentSize,
          gitlab_commit_id: gitlabCommitId,
          gitlab_commit_time: latestCommit.committedDate,
          gitlab_committer: gitlabCommitter,
          diff
        })
      } catch (error: unknown) {
        if (getCode(error) !== 'NoSuchKey' && getStatus(error) !== 404) {
          throw error
        }

        const gitlabFile = await getGitRepositoryFile({
          projectCode,
          path: file.path,
          ref: defaultBranch
        })
        const gitlabContentSize = Buffer.byteLength(gitlabFile.content, 'utf-8')
        await ossClient.put(ossPath, Buffer.from(gitlabFile.content, 'utf-8'), {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
        })
        const uploadedFile = await ossClient.head(ossPath)
        const uploadedHeaders = uploadedFile.res.headers as Record<string, string>
        await ossClient.putMeta(ossPath, {
          'gitlab-commit-id': gitlabCommitId,
          'gitlab-latest-commit-id': gitlabCommitId,
          'gitlab-latest-size': String(gitlabContentSize),
          'synced-last-modified': uploadedHeaders['last-modified'] || '',
          'synced-at': new Date().toISOString(),
          'conflict-status': '0',
          'uid': 0,
          'pid': 0
        }, {})
        result.new.push({
          doc_path: file.path,
          oss_path: ossPath,
          content_size: gitlabContentSize,
          gitlab_commit_id: gitlabCommitId,
          gitlab_commit_time: latestCommit.committedDate,
          gitlab_committer: gitlabCommitter
        })
      }
    } catch (error) {
      console.warn(`[Codocs GitLabSync] Skip ${file.path}:`, error)
    }
  }

  try {
    const ossFiles = await listAllOssFiles(ossClient, `${repoPath}/`)
    for (const ossPath of ossFiles) {
      const relativePath = ossPath.replace(`${repoPath}/`, '')
      if (!gitlabFilePaths.has(relativePath)) {
        result.deleted.push({
          doc_path: relativePath,
          oss_path: ossPath,
          gitlab_commit_id: repoLatestCommit.sha,
          gitlab_commit_time: repoLatestCommit.committedDate,
          gitlab_committer: getUidFromEmail(repoLatestCommit.authorEmail)
        })
      }
    }
  } catch (error) {
    console.warn('[Codocs GitLabSync] Failed to list OSS files:', error)
  }

  return result
}

export async function submitProjectDocsToGitLab(input: SubmitGitlabDocsInput) {
  const ossClient = createProjectsOSSClient()
  const docs: { gitlabPath: string, content: string }[] = []

  for (const doc of input.docs) {
    if (!doc.oss_path || !doc.gitlab_path) continue
    const file = await ossClient.get(doc.oss_path)
    docs.push({
      gitlabPath: doc.gitlab_path,
      content: file.content.toString('utf-8')
    })
  }

  const resolved = await resolveGitCommitActions({
    projectCode: input.projectCode,
    docs
  })
  if (resolved.actions.length === 0) {
    throw createError({ statusCode: 400, message: 'No valid documents to commit' })
  }

  const fileList = resolved.actions.map(action => action.file_path).join(', ')
  return await createGitCommit({
    projectCode: input.projectCode,
    branch: resolved.branch,
    commitMessage: `docs(bot): Update ${resolved.actions.length} file(s) from Codocs\n\nFiles: ${fileList}\n\nSubmitted by: ${input.authorName} (${input.uid})`,
    actions: resolved.actions,
    authorName: input.authorName,
    authorEmail: input.authorEmail
  })
}

export async function getRepoPathForProject(projectCode: string) {
  const tree = await listGitMarkdownTree({ projectCode })
  return extractGitProjectPath(tree.repo_path) || tree.repo_path
}
