function stripSourceEndpointPrefix(value: string) {
  return value.startsWith('gitlab:') ? value.slice('gitlab:'.length) : value
}

function stripDecorators(value: string) {
  const withoutHash = value.split('#')[0] ?? ''
  const withoutQuery = withoutHash.split('?')[0] ?? ''
  return withoutQuery
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
}

function normalizeProjectPath(path: string | null | undefined) {
  const cleaned = stripDecorators(String(path || '').trim())
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
  if (!cleaned) {
    return null
  }

  const projectOnly = stripDecorators(cleaned.split('/-/')[0] ?? '').replace(/\/+$/, '')
  const parts = projectOnly.split('/').filter(Boolean)
  if (parts.length < 2 && !/^\d+$/.test(projectOnly)) {
    return null
  }

  return parts.join('/') || null
}

export function extractGitLabProjectPath(repoUrl: string | null | undefined): string | null {
  const raw = String(repoUrl || '').trim()
  if (!raw) {
    return null
  }

  const normalized = stripDecorators(stripSourceEndpointPrefix(raw))
  if (!normalized) {
    return null
  }

  const sshMatch = normalized.match(/^[^@]+@[^:]+:(.+)$/)
  if (sshMatch?.[1]) {
    return normalizeProjectPath(sshMatch[1])
  }

  try {
    const parsed = new URL(normalized)
    return normalizeProjectPath(parsed.pathname)
  } catch {
    const hostPathMatch = normalized.match(/^[^/]+\.[^/]+\/(.+)$/)
    if (hostPathMatch?.[1]) {
      return normalizeProjectPath(hostPathMatch[1])
    }

    return normalizeProjectPath(normalized)
  }
}
