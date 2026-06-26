import { fetchConsoleDirectoryApi } from './directoryApi'
import { getGitLabRuntimeConfig } from './integrationConfig'

export interface GitIntegrationConfig {
  integrationCode: string
  baseUrl: string
  token: string
  defaultBranch?: string
}

export interface GitProjectRef {
  projectCode?: string
  repoUrl?: string
  repoPath?: string
  integrationCode?: string
}

export interface GitCommitQuery extends GitProjectRef {
  ref?: string
  path?: string
  since?: string
  until?: string
  page?: number
  perPage?: number
}

export interface GitCommitAction {
  action: 'create' | 'update' | 'delete' | 'move' | 'chmod'
  file_path: string
  content?: string
  previous_path?: string
  encoding?: 'text' | 'base64'
}

export interface CreateGitCommitInput extends GitProjectRef {
  branch?: string
  commitMessage: string
  actions: GitCommitAction[]
  authorName?: string
  authorEmail?: string
}

interface ConsoleProjectResponse {
  code?: number
  data?: {
    projectCode?: string
    repoUrl?: string | null
  }
}

interface GitLabProjectInfo {
  id: number
  default_branch: string
  path_with_namespace: string
}

interface GitLabCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  authored_date: string
  committed_date: string
  web_url: string
  stats?: { additions: number, deletions: number, total: number }
}

interface GitLabDiff {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
}

interface GitLabTreeItem {
  id: string
  name: string
  type: 'blob' | 'tree'
  path: string
}

interface GitLabFileResponse {
  file_name: string
  file_path: string
  size: number
  encoding: 'base64' | 'text'
  content: string
  ref: string
  blob_id: string
  commit_id: string
  last_commit_id: string
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function normalizeGitLabBaseUrl(value: string) {
  return trimSlash(value)
}

export function extractGitProjectPath(repoUrl: string | null | undefined, baseUrl?: string) {
  const value = stringValue(repoUrl).replace(/\.git$/, '')
  if (!value) return null

  const normalizedBaseUrl = stringValue(baseUrl)
  if (normalizedBaseUrl && value.startsWith(normalizeGitLabBaseUrl(normalizedBaseUrl))) {
    return value.slice(normalizeGitLabBaseUrl(normalizedBaseUrl).length).replace(/^\/+/, '') || null
  }

  try {
    const url = new URL(value)
    return url.pathname.replace(/^\/+/, '') || null
  } catch {
    return value.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '') || null
  }
}

export async function getGitIntegrationConfig(integrationCode = 'gitlab.default'): Promise<GitIntegrationConfig> {
  const runtime = await getGitLabRuntimeConfig(integrationCode)
  if (!runtime.baseUrl || !runtime.token) {
    throw createError({ statusCode: 503, message: 'GitLab integration is not configured in Console' })
  }

  return {
    integrationCode,
    baseUrl: normalizeGitLabBaseUrl(runtime.baseUrl),
    token: runtime.token,
    defaultBranch: stringValue(runtime.config.defaultBranch) || undefined
  }
}

export async function gitIntegrationFetch<T>(
  path: string,
  options: {
    integrationCode?: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    timeout?: number
  } = {}
): Promise<T> {
  const config = await getGitIntegrationConfig(options.integrationCode)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const externalFetch = $fetch as unknown as <R>(request: string, options: {
    method?: string
    headers?: Record<string, string>
    body?: Record<string, unknown> | BodyInit | null
    timeout?: number
  }) => Promise<R>

  const fetchOptions: {
    method?: string
    headers: Record<string, string>
    body?: Record<string, unknown> | BodyInit | null
    timeout: number
  } = {
    method: options.method,
    headers: {
      'PRIVATE-TOKEN': config.token
    },
    timeout: options.timeout || 15000
  }
  if (options.body !== undefined) {
    fetchOptions.body = options.body as Record<string, unknown> | BodyInit | null
  }

  return await externalFetch<T>(`${config.baseUrl}${normalizedPath}`, fetchOptions)
}

async function resolveRepoPath(input: GitProjectRef, config: GitIntegrationConfig) {
  const repoPath = stringValue(input.repoPath)
  if (repoPath) return repoPath.replace(/\.git$/, '')

  const repoUrl = stringValue(input.repoUrl)
  if (repoUrl) {
    const extracted = extractGitProjectPath(repoUrl, config.baseUrl)
    if (extracted) return extracted
  }

  const projectCode = stringValue(input.projectCode)
  if (projectCode) {
    const response = await fetchConsoleDirectoryApi<ConsoleProjectResponse>(
      `/projects/${encodeURIComponent(projectCode)}`
    )
    const projectRepoUrl = response.data?.repoUrl
    const extracted = extractGitProjectPath(projectRepoUrl, config.baseUrl)
    if (extracted) return extracted
  }

  throw createError({ statusCode: 400, message: 'repoPath, repoUrl or projectCode is required' })
}

export async function getGitProjectInfo(input: GitProjectRef) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  return await gitIntegrationFetch<GitLabProjectInfo>(
    `/api/v4/projects/${encodedPath}`,
    { integrationCode: input.integrationCode }
  )
}

export async function getGitDefaultBranch(input: GitProjectRef) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  if (config.defaultBranch) return config.defaultBranch

  try {
    const project = await getGitProjectInfo(input)
    return project.default_branch || 'main'
  } catch {
    return 'main'
  }
}

export async function listGitCommits(input: GitCommitQuery) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  const params = new URLSearchParams()

  params.set('page', String(numberValue(input.page, 1, 10000)))
  params.set('per_page', String(numberValue(input.perPage, 50, 100)))
  params.set('with_stats', 'true')
  if (input.ref) params.set('ref_name', input.ref)
  if (input.path) params.set('path', input.path)
  if (input.since) params.set('since', input.since)
  if (input.until) params.set('until', input.until)

  const commits = await gitIntegrationFetch<GitLabCommit[]>(
    `/api/v4/projects/${encodedPath}/repository/commits?${params.toString()}`,
    { integrationCode: input.integrationCode, timeout: 30000 }
  )

  return commits.map(commit => ({
    sha: commit.id,
    shortSha: commit.short_id,
    title: commit.title,
    message: commit.message,
    authorName: commit.author_name,
    authorEmail: commit.author_email,
    authoredDate: commit.authored_date,
    committedDate: commit.committed_date,
    webUrl: commit.web_url,
    additions: commit.stats?.additions ?? null,
    deletions: commit.stats?.deletions ?? null,
    total: commit.stats?.total ?? null
  }))
}

export async function getGitCommitDiff(input: GitProjectRef & { sha: string }) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  const sha = stringValue(input.sha)
  if (!sha) throw createError({ statusCode: 400, message: 'sha is required' })

  const diffs = await gitIntegrationFetch<GitLabDiff[]>(
    `/api/v4/projects/${encodedPath}/repository/commits/${encodeURIComponent(sha)}/diff`,
    { integrationCode: input.integrationCode }
  )

  return diffs.map(diff => ({
    oldPath: diff.old_path,
    newPath: diff.new_path,
    newFile: diff.new_file,
    renamedFile: diff.renamed_file,
    deletedFile: diff.deleted_file,
    diff: diff.diff
  }))
}

function isTargetMarkdownPath(path: string) {
  const normalized = path.toLowerCase()
  return normalized.endsWith('.md') && (!path.includes('/') || /^docs\//i.test(path))
}

export async function listGitMarkdownTree(input: GitProjectRef & { ref?: string }) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  const defaultBranch = await getGitDefaultBranch(input)
  const ref = stringValue(input.ref) || defaultBranch

  let headCommitId = ''
  try {
    const commits = await gitIntegrationFetch<GitLabCommit[]>(
      `/api/v4/projects/${encodedPath}/repository/commits?ref_name=${encodeURIComponent(ref)}&per_page=1`,
      { integrationCode: input.integrationCode }
    )
    headCommitId = commits[0]?.id || ''
  } catch {
    headCommitId = ''
  }

  let allFiles: GitLabTreeItem[] = []
  let page = 1
  while (page <= 20) {
    const response = await gitIntegrationFetch<GitLabTreeItem[]>(
      `/api/v4/projects/${encodedPath}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(ref)}&page=${page}`,
      { integrationCode: input.integrationCode, timeout: 30000 }
    )
    if (!response.length) break
    allFiles = allFiles.concat(response)
    if (response.length < 100) break
    page++
  }

  const files = allFiles
    .filter(file => file.type === 'blob' && isTargetMarkdownPath(file.path))
    .map(file => ({
      path: file.path,
      name: file.name,
      blob_id: file.id
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

  return {
    files,
    ref,
    default_branch: defaultBranch,
    head_commit_id: headCommitId,
    repo_path: repoPath
  }
}

export async function getGitRepositoryFile(input: GitProjectRef & { path: string, ref?: string, commitId?: string }) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  const filePath = stringValue(input.path)
  if (!filePath) throw createError({ statusCode: 400, message: 'path is required' })

  const defaultBranch = await getGitDefaultBranch(input)
  const ref = stringValue(input.commitId) || stringValue(input.ref) || defaultBranch
  const file = await gitIntegrationFetch<GitLabFileResponse>(
    `/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`,
    { integrationCode: input.integrationCode }
  )
  const content = file.encoding === 'base64'
    ? Buffer.from(file.content, 'base64').toString('utf-8')
    : file.content

  return {
    path: file.file_path,
    name: file.file_name,
    size: file.size,
    encoding: file.encoding,
    content,
    ref: file.ref,
    blobId: file.blob_id,
    commitId: file.commit_id,
    lastCommitId: file.last_commit_id
  }
}

export async function createGitCommit(input: CreateGitCommitInput) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  const branch = stringValue(input.branch) || await getGitDefaultBranch(input)
  const commitMessage = stringValue(input.commitMessage)

  if (!commitMessage) throw createError({ statusCode: 400, message: 'commitMessage is required' })
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw createError({ statusCode: 400, message: 'actions is required' })
  }

  const commit = await gitIntegrationFetch<{ id?: string, short_id?: string, web_url?: string }>(
    `/api/v4/projects/${encodedPath}/repository/commits`,
    {
      integrationCode: input.integrationCode,
      method: 'POST',
      body: {
        branch,
        commit_message: commitMessage,
        actions: input.actions,
        author_name: stringValue(input.authorName) || undefined,
        author_email: stringValue(input.authorEmail) || undefined
      },
      timeout: 30000
    }
  )

  if (!commit?.id && !commit?.short_id) {
    throw createError({ statusCode: 502, message: 'GitLab commit response is invalid' })
  }

  return {
    revision: commit.short_id || commit.id,
    commitId: commit.id,
    webUrl: commit.web_url,
    repoPath,
    branch
  }
}

export async function resolveGitCommitActions(input: GitProjectRef & {
  branch?: string
  docs: { gitlabPath: string, content: string }[]
}) {
  const config = await getGitIntegrationConfig(input.integrationCode)
  const repoPath = await resolveRepoPath(input, config)
  const encodedPath = encodeURIComponent(repoPath)
  const branch = stringValue(input.branch) || await getGitDefaultBranch(input)
  const actions: GitCommitAction[] = []

  for (const doc of input.docs) {
    const gitlabPath = stringValue(doc.gitlabPath)
    if (!gitlabPath) continue

    let action: 'create' | 'update' = 'create'
    try {
      await gitIntegrationFetch(
        `/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(gitlabPath)}?ref=${encodeURIComponent(branch)}`,
        { integrationCode: input.integrationCode }
      )
      action = 'update'
    } catch (error: unknown) {
      const status = (error as { status?: number, statusCode?: number })?.status || (error as { statusCode?: number })?.statusCode
      if (status !== 404) throw error
    }

    actions.push({
      action,
      file_path: gitlabPath,
      content: doc.content,
      encoding: 'text'
    })
  }

  return { repoPath, branch, actions }
}
