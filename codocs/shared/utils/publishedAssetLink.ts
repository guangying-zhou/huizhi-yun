export type PublishedAssetScope = 'company' | 'departments'

export function publishedAssetShortPagePath(token: unknown) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16}$/.test(token) ? `/s/${token}` : ''
}

export function parsePublishedAssetPath(value: unknown, scope?: PublishedAssetScope) {
  if (typeof value !== 'string' || !value || value.length > 800 || value.includes('\\')) return null
  if (Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  const assetScope = segments[1]
  if (segments[0] !== 'codocs' || (assetScope !== 'company' && assetScope !== 'departments')) return null
  if (scope && scope !== assetScope) return null
  if (segments.length < (assetScope === 'company' ? 4 : 5)) return null
  const category = segments[assetScope === 'company' ? 2 : 3]!
  const categories = assetScope === 'company'
    ? ['rules', 'notices', 'legal', 'culture', 'tech-specs', 'knowledge', 'templates', 'products']
    : ['rules', 'records', 'outsides']
  if (!categories.includes(category)) return null
  return { path: value, scope: assetScope, name: segments.at(-1)! }
}

export function publishedAssetPagePath(path: string) {
  const asset = parsePublishedAssetPath(path)
  if (!asset) return ''
  return `/${asset.scope}/document?${new URLSearchParams({ path: asset.path })}`
}
