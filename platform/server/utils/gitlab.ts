import { createError } from 'h3'
import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { extractGitLabProjectPath } from '~~/server/utils/gitlabProjectPath'

export interface PlatformGitLabConfig {
  baseUrl: string
  token: string
  defaultManifestPath: string
  requestTimeoutMs: number
}

interface GitLabTag {
  name: string
  commit?: {
    id?: string
    short_id?: string
  }
}

interface GitLabCommit {
  id: string
  short_id?: string
}

interface GitLabReleaseRaw {
  name?: string
  tag_name?: string
  description?: string
  released_at?: string
  created_at?: string
  commit?: {
    id?: string
    short_id?: string
  }
  upcoming_release?: boolean
}

export interface GitLabReleaseSummary {
  tagName: string
  name: string
  description: string | null
  releasedAt: string | null
  createdAt: string | null
  commitSha: string | null
  upcoming: boolean
}

type CloudflareRuntimeEnv = {
  [key: string]: unknown
}

type PlatformRuntimeConfig = {
  gitlab?: Partial<PlatformGitLabConfig>
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv(event?: H3Event): CloudflareRuntimeEnv {
  const context = event?.context as H3Event['context'] & {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  } | undefined

  const globalEnv = globalThis as typeof globalThis & {
    __hzyCloudflareEnv?: CloudflareRuntimeEnv
    __env__?: CloudflareRuntimeEnv
  }

  return context?.cloudflare?.env
    || context?._platform?.cloudflare?.env
    || context?.nitro?.env
    || globalEnv.__hzyCloudflareEnv
    || globalEnv.__env__
    || {}
}

function runtimeEnvValue(event: H3Event | undefined, names: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const name of names) {
    const value = stringValue(cloudflareEnv[name]) || stringValue(process.env[name])
    if (value) return value
  }
  return ''
}

function firstRuntimeValue(values: unknown[]) {
  for (const value of values) {
    const normalized = stringValue(value)
    if (normalized) return normalized
  }
  return ''
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getPlatformGitLabConfig(event?: H3Event): PlatformGitLabConfig {
  const config = (event ? useRuntimeConfig(event) : useRuntimeConfig()) as unknown as PlatformRuntimeConfig
  const gitlab = config.gitlab || {}
  const baseUrl = firstRuntimeValue([
    runtimeEnvValue(event, ['GITLAB_BASE_URL']),
    gitlab.baseUrl
  ])
  const token = firstRuntimeValue([
    runtimeEnvValue(event, ['GITLAB_BOT_TOKEN', 'GITLAB_API_TOKEN']),
    gitlab.token
  ])

  if (!baseUrl || !token) {
    const missing = [
      !baseUrl ? 'GITLAB_BASE_URL' : '',
      !token ? 'GITLAB_BOT_TOKEN/GITLAB_API_TOKEN' : ''
    ].filter(Boolean)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: `GitLab config missing: ${missing.join(', ')}`
    })
  }

  return {
    baseUrl: trimTrailingSlash(baseUrl),
    token,
    defaultManifestPath: firstRuntimeValue([
      runtimeEnvValue(event, ['GITLAB_DEFAULT_APP_MANIFEST_PATH']),
      gitlab.defaultManifestPath,
      'app.manifest.json'
    ]) || 'app.manifest.json',
    requestTimeoutMs: Number(firstRuntimeValue([
      runtimeEnvValue(event, ['GITLAB_REQUEST_TIMEOUT_MS']),
      gitlab.requestTimeoutMs,
      15000
    ]) || 15000)
  }
}

export function encodeGitLabProjectPath(projectPath: string) {
  return encodeURIComponent(projectPath)
}

export function encodeGitLabFilePath(filePath: string) {
  return encodeURIComponent(filePath.replace(/^\/+/, ''))
}

export async function gitlabFetch<T>(path: string, config: PlatformGitLabConfig = getPlatformGitLabConfig()): Promise<T> {
  const url = path.startsWith('http') ? path : `${config.baseUrl}${path}`
  const fetchJson = $fetch as <R>(request: string, options?: {
    headers?: Record<string, string>
    timeout?: number
  }) => Promise<R>

  const response = await fetchJson<T>(url, {
    headers: {
      'PRIVATE-TOKEN': config.token
    },
    timeout: config.requestTimeoutMs
  })
  return response as T
}

function getFetchStatus(error: unknown) {
  const typedError = error as { status?: number, statusCode?: number, response?: { status?: number } }
  return typedError.status || typedError.statusCode || typedError.response?.status || 0
}

function buildRefCandidates(ref: string) {
  const normalizedRef = ref.trim()
  if (!normalizedRef) {
    return []
  }

  const candidates = [normalizedRef]
  if (!normalizedRef.startsWith('v')) {
    candidates.push(`v${normalizedRef}`)
  }
  return [...new Set(candidates)]
}

export async function resolveGitLabRefToCommitSha(repoUrl: string, ref: string, config: PlatformGitLabConfig = getPlatformGitLabConfig()) {
  const projectPath = extractGitLabProjectPath(repoUrl)
  if (!projectPath) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `invalid GitLab repoUrl: ${repoUrl}` })
  }

  const encodedProjectPath = encodeGitLabProjectPath(projectPath)
  const refCandidates = buildRefCandidates(ref)

  for (const candidate of refCandidates) {
    try {
      const tag = await gitlabFetch<GitLabTag>(`/api/v4/projects/${encodedProjectPath}/repository/tags/${encodeURIComponent(candidate)}`, config)
      if (tag.commit?.id) {
        return tag.commit.id
      }
    } catch (error) {
      const status = getFetchStatus(error)
      if (status !== 404) {
        throw error
      }
    }
  }

  for (const candidate of refCandidates) {
    try {
      const commit = await gitlabFetch<GitLabCommit>(`/api/v4/projects/${encodedProjectPath}/repository/commits/${encodeURIComponent(candidate)}`, config)
      return commit.id
    } catch (error) {
      const status = getFetchStatus(error)
      if (status !== 404) {
        throw error
      }
    }
  }

  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: `GitLab ref/tag not found: ${ref}. Tried: ${refCandidates.join(', ')}`
  })
}

export async function listGitLabReleases(repoUrl: string, config: PlatformGitLabConfig = getPlatformGitLabConfig()): Promise<GitLabReleaseSummary[]> {
  const projectPath = extractGitLabProjectPath(repoUrl)
  if (!projectPath) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `invalid GitLab repoUrl: ${repoUrl}` })
  }

  const encodedProjectPath = encodeGitLabProjectPath(projectPath)
  const releases = await gitlabFetch<GitLabReleaseRaw[]>(
    `/api/v4/projects/${encodedProjectPath}/releases?per_page=100`,
    config
  )

  if (!Array.isArray(releases)) {
    return []
  }

  return releases
    .map((release) => {
      const tagName = String(release.tag_name || '').trim()
      if (!tagName) {
        return null
      }

      return {
        tagName,
        name: String(release.name || tagName).trim() || tagName,
        description: release.description ? String(release.description) : null,
        releasedAt: release.released_at ? String(release.released_at) : null,
        createdAt: release.created_at ? String(release.created_at) : null,
        commitSha: release.commit?.id ? String(release.commit.id) : null,
        upcoming: Boolean(release.upcoming_release)
      }
    })
    .filter((item): item is GitLabReleaseSummary => Boolean(item))
}

export async function fetchGitLabRawFile(repoUrl: string, filePath: string, ref: string, config: PlatformGitLabConfig = getPlatformGitLabConfig()) {
  const projectPath = extractGitLabProjectPath(repoUrl)
  if (!projectPath) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `invalid GitLab repoUrl: ${repoUrl}` })
  }

  const encodedProjectPath = encodeGitLabProjectPath(projectPath)
  const encodedFilePath = encodeGitLabFilePath(filePath)
  const params = new URLSearchParams({ ref })

  return await gitlabFetch<string>(`/api/v4/projects/${encodedProjectPath}/repository/files/${encodedFilePath}/raw?${params.toString()}`, config)
}
