/**
 * GitLab API 共用工具
 * - extractGitLabProjectPath：从 repo_url 解析 group/project
 * - gitlabFetch：发起 GitLab API 调用（自动带 token）
 * - getGitLabConfig：读取环境变量，校验必填
 */

export function extractGitLabProjectPath(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null
  try {
    const url = repoUrl.replace(/\.git$/, '')
    const match = url.match(/[^/]+\.[^/]+\/(.+)$/)
    return match && match[1] ? match[1] : null
  } catch {
    return null
  }
}

export interface GitLabConfig {
  baseUrl: string
  token: string
}

export function getGitLabConfig(): GitLabConfig {
  const baseUrl = process.env.GITLAB_BASE_URL
  const token = process.env.GITLAB_BOT_TOKEN
  if (!baseUrl || !token) {
    throw createError({ statusCode: 500, message: 'GitLab 配置缺失（GITLAB_BASE_URL/GITLAB_BOT_TOKEN）' })
  }
  return { baseUrl, token }
}

export async function gitlabFetch<T>(path: string, config?: GitLabConfig): Promise<T> {
  const cfg = config || getGitLabConfig()
  const url = path.startsWith('http') ? path : `${cfg.baseUrl}${path}`
  return await $fetch<T>(url, {
    headers: { 'PRIVATE-TOKEN': cfg.token }
  })
}

interface GitLabProjectInfo {
  id: number
  default_branch: string
  path_with_namespace: string
}

/**
 * 拉取 GitLab 项目的默认分支（main/master 等）
 */
export async function getDefaultBranch(encodedPath: string, config?: GitLabConfig): Promise<string> {
  try {
    const info = await gitlabFetch<GitLabProjectInfo>(`/api/v4/projects/${encodedPath}`, config)
    return info.default_branch || 'main'
  } catch {
    return 'main'
  }
}
