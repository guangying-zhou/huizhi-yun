import { createError, defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { getRequestOrigin } from '@hzy/foundation/server/utils/appUrls'
import {
  assertAuthorizePkce,
  assertAuthorizeRedirectUri,
  createAuthorizeCodeRecord,
  normalizeAuthorizeScope,
  requireAuthorizeOidcClient
} from '~~/server/utils/oidcAuthorize'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'

function first(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function buildPublicRequestUrl(event: Parameters<typeof getRequestURL>[0]) {
  const requestUrl = getRequestURL(event)
  return `${getRequestOrigin(event)}${requestUrl.pathname}${requestUrl.search}`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  if (first(query.response_type) !== 'code') {
    throw createError({ statusCode: 400, message: 'unsupported_response_type: only code is supported' })
  }

  const client = await requireAuthorizeOidcClient(first(query.client_id))
  const redirectUri = await assertAuthorizeRedirectUri(client, first(query.redirect_uri), 'redirect')
  const scope = normalizeAuthorizeScope(first(query.scope))
  const state = typeof first(query.state) === 'string' ? String(first(query.state)) : ''
  if (!state) {
    throw createError({ statusCode: 400, message: 'invalid_request: state is required' })
  }
  const nonce = typeof first(query.nonce) === 'string' ? String(first(query.nonce)) : ''
  const pkce = assertAuthorizePkce({
    codeChallenge: first(query.code_challenge),
    codeChallengeMethod: first(query.code_challenge_method)
  })

  const session = await resolveOptionalConsoleSession(event)
  if (!session) {
    const requestUrl = buildPublicRequestUrl(event)
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(requestUrl)}`)
  }

  const code = await createAuthorizeCodeRecord({
    event,
    client,
    session,
    redirectUri,
    scope,
    state,
    nonce,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod
  })

  return sendRedirect(event, buildRedirect(redirectUri, { code, state }))
})
