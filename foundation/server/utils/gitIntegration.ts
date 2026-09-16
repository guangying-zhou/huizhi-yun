import { createError } from 'h3'
import { fetchConsoleDirectoryApi } from './directoryApi'
import { maybeCallTenantRuntime } from './tenantRuntimeClient'

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

export interface UpsertGitIssueInput extends GitProjectRef {
  externalKey: string
  title: string
  description?: string
  state: 'opened' | 'closed'
  labels?: string[]
  dueDate?: string
  issueIid?: number
  idempotencyKey: string
}

interface ConsoleProjectResponse {
  code?: number
  data?: {
    projectCode?: string
    repoUrl?: string | null
  }
}

type ConsoleRuntimeEnvelope<T> = {
  code: number
  data: T
  message?: string
}

type GitLabFixedOperation
  = | 'project-info'
    | 'group-projects'
    | 'commits'
    | 'commit-diff'
    | 'markdown-tree'
    | 'file'
    | 'commit'
    | 'issue-upsert'
    | 'resolve-actions'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export function extractGitProjectPath(repoUrl: string | null | undefined, baseUrl?: string) {
  const value = stringValue(repoUrl).replace(/\.git$/, '')
  if (!value) return null

  const normalizedBaseUrl = stringValue(baseUrl).replace(/\/+$/, '')
  if (normalizedBaseUrl && value.startsWith(normalizedBaseUrl)) {
    return value.slice(normalizedBaseUrl.length).replace(/^\/+/, '') || null
  }

  try {
    const url = new URL(value)
    return url.pathname.replace(/^\/+/, '') || null
  } catch {
    return value.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '') || null
  }
}

async function resolveRepoPath(input: GitProjectRef) {
  const repoPath = stringValue(input.repoPath)
  if (repoPath) return repoPath.replace(/\.git$/, '')

  const repoUrl = stringValue(input.repoUrl)
  if (repoUrl) {
    const extracted = extractGitProjectPath(repoUrl)
    if (extracted) return extracted
  }

  const projectCode = stringValue(input.projectCode)
  if (projectCode) {
    const event = useEvent()
    if (!event) {
      throw createError({
        statusCode: 503,
        message: 'Git project lookup requires a request-bound user identity'
      })
    }
    const response = await fetchConsoleDirectoryApi<ConsoleProjectResponse>(
      `/projects/${encodeURIComponent(projectCode)}`,
      { event }
    )
    const extracted = extractGitProjectPath(response.data?.repoUrl)
    if (extracted) return extracted
  }

  throw createError({ statusCode: 400, message: 'repoPath, repoUrl or projectCode is required' })
}

async function callGitLabFixedOperation<T>(
  integrationCode: string | undefined,
  operation: GitLabFixedOperation,
  body: Record<string, unknown>,
  options: { idempotencyKey?: string } = {}
) {
  const event = useEvent()
  if (!event) {
    throw createError({
      statusCode: 503,
      message: 'GitLab fixed operation requires a request-bound service identity'
    })
  }
  const code = stringValue(integrationCode) || 'gitlab.default'
  const runtime = await maybeCallTenantRuntime<ConsoleRuntimeEnvelope<T>>(
    event,
    `/v1/console/service/integrations/${encodeURIComponent(code)}/gitlab/${operation}`,
    {
      appCode: 'console',
      scope: 'integration_operations:execute',
      serviceTokenSourceBinding: 'service-client-policy',
      idempotencyKey: options.idempotencyKey,
      method: 'POST',
      body
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Console Tenant Runtime is required for GitLab operations'
    })
  }
  return runtime.data.data
}

export async function upsertGitIssue(input: UpsertGitIssueInput) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<{
    iid: number
    webUrl: string
    state: 'opened' | 'closed'
    created: boolean
  }>(input.integrationCode, 'issue-upsert', {
    repoPath,
    externalKey: stringValue(input.externalKey),
    title: stringValue(input.title),
    description: String(input.description || ''),
    state: input.state,
    labels: input.labels,
    dueDate: input.dueDate,
    issueIid: input.issueIid
  }, { idempotencyKey: input.idempotencyKey })
}

export async function getGitProjectInfo(input: GitProjectRef) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<{
    id: number
    default_branch: string
    path_with_namespace: string
  }>(input.integrationCode, 'project-info', { repoPath })
}

export async function listGitGroupProjects(input: {
  groupPath: string
  integrationCode?: string
  includeArchived?: boolean
}) {
  const groupPath = stringValue(input.groupPath)
  if (!groupPath) {
    throw createError({ statusCode: 400, message: 'groupPath is required' })
  }
  return await callGitLabFixedOperation<{
    items: Array<{
      id: number
      projectCode: string
      parentId: string
      name: string
      repoUrl: string
      archived: boolean
      isGroup: 0
      isTemplate: 0
    }>
    total: number
  }>(input.integrationCode, 'group-projects', {
    repoPath: groupPath,
    includeArchived: input.includeArchived !== false
  })
}

export async function getGitDefaultBranch(input: GitProjectRef) {
  try {
    const project = await getGitProjectInfo(input)
    return project.default_branch || 'main'
  } catch {
    return 'main'
  }
}

export async function listGitCommits(input: GitCommitQuery) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<Array<{
    sha: string
    shortSha: string
    title: string
    message: string
    authorName: string
    authorEmail: string
    authoredDate: string
    committedDate: string
    webUrl: string
    additions: number | null
    deletions: number | null
    total: number | null
  }>>(input.integrationCode, 'commits', {
    repoPath,
    ref: input.ref,
    path: input.path,
    since: input.since,
    until: input.until,
    page: input.page,
    perPage: input.perPage
  })
}

export async function getGitCommitDiff(input: GitProjectRef & { sha: string }) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<Array<{
    oldPath: string
    newPath: string
    newFile: boolean
    renamedFile: boolean
    deletedFile: boolean
    diff: string
  }>>(input.integrationCode, 'commit-diff', {
    repoPath,
    sha: stringValue(input.sha)
  })
}

export async function listGitMarkdownTree(input: GitProjectRef & { ref?: string }) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<{
    files: { path: string, name: string, blob_id: string }[]
    ref: string
    default_branch: string
    head_commit_id: string
    repo_path: string
  }>(input.integrationCode, 'markdown-tree', {
    repoPath,
    ref: input.ref
  })
}

export async function getGitRepositoryFile(
  input: GitProjectRef & { path: string, ref?: string, commitId?: string }
) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<{
    path: string
    name: string
    size: number
    encoding: string
    content: string
    ref: string
    blobId: string
    commitId: string
    lastCommitId: string
  }>(input.integrationCode, 'file', {
    repoPath,
    path: stringValue(input.path),
    ref: input.ref,
    commitId: input.commitId
  })
}

export async function createGitCommit(input: CreateGitCommitInput) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<{
    revision: string
    commitId: string
    webUrl: string
    repoPath: string
    branch: string
  }>(input.integrationCode, 'commit', {
    repoPath,
    branch: input.branch,
    commitMessage: input.commitMessage,
    actions: input.actions,
    authorName: input.authorName,
    authorEmail: input.authorEmail
  })
}

export async function resolveGitCommitActions(input: GitProjectRef & {
  branch?: string
  docs: { gitlabPath: string, content: string }[]
}) {
  const repoPath = await resolveRepoPath(input)
  return await callGitLabFixedOperation<{
    repoPath: string
    branch: string
    actions: GitCommitAction[]
  }>(input.integrationCode, 'resolve-actions', {
    repoPath,
    branch: input.branch,
    docs: input.docs
  })
}
