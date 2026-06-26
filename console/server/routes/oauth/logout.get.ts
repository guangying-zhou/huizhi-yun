import { defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { assertRedirectUri, requireOidcClient } from '~~/server/utils/oidc'
import { revokeConsoleSession, setConsoleLogoutMarker } from '~~/server/utils/authSession'
import { getUpstreamOidcLogoutUrl } from '~~/server/utils/upstreamOidc'

function first(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function appendState(url: string, state: string) {
  if (!state) return url
  const isRelative = url.startsWith('/') && !url.startsWith('//')
  const target = new URL(url, isRelative ? 'http://localhost' : undefined)
  target.searchParams.set('state', state)
  if (isRelative) {
    return `${target.pathname}${target.search}${target.hash}`
  }
  return target.toString()
}

function toAbsoluteRedirect(event: Parameters<typeof getRequestURL>[0], redirect: string) {
  if (!redirect.startsWith('/') || redirect.startsWith('//')) {
    return redirect
  }

  const current = getRequestURL(event)
  return `${current.protocol}//${current.host}${redirect}`
}

async function buildUpstreamLogoutRedirect(event: Parameters<typeof getRequestURL>[0], finalRedirect: string) {
  const oidcLogoutUrl = await getUpstreamOidcLogoutUrl(event, toAbsoluteRedirect(event, finalRedirect))
  if (oidcLogoutUrl) {
    return oidcLogoutUrl
  }

  const config = useRuntimeConfig(event)
  const casEnabled = config.public?.casEnable === true || String(config.public?.casEnable || '').toLowerCase() === 'true'
  const casBaseUrl = String(config.public?.casBaseUrl || '').trim()

  if (!casEnabled || !casBaseUrl) {
    return finalRedirect
  }

  const service = toAbsoluteRedirect(event, finalRedirect)
  return `${casBaseUrl.replace(/\/$/, '')}/cas/logout?service=${encodeURIComponent(service)}`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  await revokeConsoleSession(event)
  setConsoleLogoutMarker(event)

  const postLogoutRedirectUri = typeof first(query.post_logout_redirect_uri) === 'string'
    ? String(first(query.post_logout_redirect_uri)).trim()
    : ''
  const clientId = typeof first(query.client_id) === 'string'
    ? String(first(query.client_id)).trim()
    : ''
  const state = typeof first(query.state) === 'string' ? String(first(query.state)) : ''

  if (postLogoutRedirectUri && clientId) {
    const client = await requireOidcClient(clientId)
    const redirectUri = await assertRedirectUri(client, postLogoutRedirectUri, 'post_logout')
    const finalRedirect = appendState(redirectUri, state)
    return sendRedirect(event, await buildUpstreamLogoutRedirect(event, finalRedirect))
  }

  const finalRedirect = appendState('/login', state || 'logged_out')
  return sendRedirect(event, await buildUpstreamLogoutRedirect(event, finalRedirect))
})
