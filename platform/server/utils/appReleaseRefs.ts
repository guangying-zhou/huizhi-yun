export function normalizeReleaseTagPrefix(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!normalized) return null

  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /\s/.test(segment))) {
    throw new Error('releaseTagPrefix must be a slash-delimited Git tag prefix without whitespace or dot segments')
  }

  return `${normalized}/`
}

export function normalizeManifestPath(value: unknown, fallback = 'app.manifest.json'): string {
  const normalized = String(value ?? '').trim().replace(/^\/+/, '') || fallback
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('manifestPath must be a repository-relative path without dot segments')
  }
  return normalized
}

export function qualifyReleaseRef(ref: string, prefix: string | null): string {
  const normalizedRef = ref.trim()
  if (!prefix || normalizedRef.startsWith(prefix)) return normalizedRef
  return `${prefix}${normalizedRef}`
}

export function releaseVersionFromTag(tag: string, prefix: string | null): string {
  const normalizedTag = tag.trim()
  return prefix && normalizedTag.startsWith(prefix)
    ? normalizedTag.slice(prefix.length)
    : normalizedTag
}

export function buildReleaseRefCandidates(ref: string): string[] {
  const normalizedRef = ref.trim()
  if (!normalizedRef) return []

  const slash = normalizedRef.lastIndexOf('/')
  const namespace = slash >= 0 ? normalizedRef.slice(0, slash + 1) : ''
  const leaf = slash >= 0 ? normalizedRef.slice(slash + 1) : normalizedRef
  const candidates = [normalizedRef]
  if (leaf && !leaf.startsWith('v')) candidates.push(`${namespace}v${leaf}`)
  return [...new Set(candidates)]
}
