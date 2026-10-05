const documentUuid = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function isPublicCodocsEditorShell(path: unknown, marker: unknown) {
  return marker === true
    && /^\/(?:codocs\/)?embed\/editor\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(path || ''))
}

export function resolveCodocsEditorTarget(baseUrl: unknown, uuid: unknown, options: { readonly?: boolean, showTitle?: boolean } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '')
  const id = String(uuid || '')
  if (!documentUuid.test(id)) return null
  try {
    const parsed = new URL(base)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || !['/', '/codocs', '/codocs/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null
    const params = new URLSearchParams()
    if (options.readonly) params.set('readonly', '1')
    if (options.showTitle === false) params.set('title', '0')
    const query = params.toString()
    const prefix = parsed.pathname.startsWith('/codocs') ? '/codocs' : ''
    return { origin: parsed.origin, src: `${parsed.origin}${prefix}/embed/editor/${encodeURIComponent(id)}${query ? `?${query}` : ''}` }
  } catch {
    return null
  }
}

export function isTrustedCodocsEditorMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, origin: string, source: Window | null | undefined) {
  return Boolean(origin && source && event.origin === origin && event.source === source
    && event.data?.type === 'codocs:content' && typeof event.data.content === 'string')
}
