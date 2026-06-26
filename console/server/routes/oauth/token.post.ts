import type { H3Event } from 'h3'
import { createError, defineEventHandler, getHeader, readBody, readRawBody, setHeader } from 'h3'
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  hashOpaqueValue,
  issueServiceAccessToken,
  issueTokenSet,
  requireOidcClient,
  writeTokenEvent
} from '~~/server/utils/oidc'
import { consumeRuntimeAppIdentity, consumeServiceClientCredentials } from '~~/server/utils/serviceClients'

type TokenBody = Record<string, unknown>

function stringValue(value: unknown) {
  return String(value || '').trim()
}

async function readTokenBody(event: H3Event): Promise<TokenBody> {
  const contentType = String(getHeader(event, 'content-type') || '').toLowerCase()
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await readRawBody(event, 'utf8')
    return Object.fromEntries(new URLSearchParams(raw || ''))
  }
  return await readBody<TokenBody>(event).catch(() => ({}))
}

function basicClientCredentials(event: H3Event) {
  const authorization = String(getHeader(event, 'authorization') || '').trim()
  const match = authorization.match(/^Basic\s+(.+)$/i)
  if (!match?.[1]) {
    return { clientId: '', clientSecret: '' }
  }

  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0) {
    return { clientId: decoded.trim(), clientSecret: '' }
  }

  return {
    clientId: decoded.slice(0, separator).trim(),
    clientSecret: decoded.slice(separator + 1).trim()
  }
}

export default defineEventHandler(async (event) => {
  const body = await readTokenBody(event)
  const grantType = stringValue(body.grant_type)
  const basicCredentials = basicClientCredentials(event)

  try {
    if (grantType === 'authorization_code') {
      const client = await requireOidcClient(body.client_id)
      const result = await consumeAuthorizationCode({
        code: stringValue(body.code),
        clientId: client.clientId,
        redirectUri: stringValue(body.redirect_uri),
        codeVerifier: stringValue(body.code_verifier)
      })
      const tokenSet = await issueTokenSet({
        event,
        client: result.client,
        session: result.session,
        scope: result.scope,
        nonce: result.nonce,
        issueRefreshToken: result.scope.split(/\s+/).includes('offline_access')
      })

      await writeTokenEvent(event, {
        eventType: 'issue',
        clientId: result.client.clientId,
        uid: result.session.uid,
        sessionHash: result.session.storedSessionId,
        result: 'success'
      })

      setHeader(event, 'Cache-Control', 'no-store')
      return {
        access_token: tokenSet.accessToken,
        id_token: tokenSet.idToken,
        refresh_token: tokenSet.refreshToken || undefined,
        token_type: tokenSet.tokenType,
        expires_in: tokenSet.expiresIn
      }
    }

    if (grantType === 'refresh_token') {
      const client = await requireOidcClient(body.client_id)
      const refreshToken = stringValue(body.refresh_token)
      const result = await consumeRefreshToken(event, refreshToken, client.clientId)
      const tokenSet = await issueTokenSet({
        event,
        client: result.client,
        session: result.session,
        scope: 'openid offline_access',
        issueRefreshToken: true,
        refreshTokenFamily: result.tokenFamily
      })

      await writeTokenEvent(event, {
        eventType: 'refresh',
        clientId: result.client.clientId,
        uid: result.session.uid,
        sessionHash: result.session.storedSessionId,
        tokenHash: hashOpaqueValue(refreshToken),
        result: 'success'
      })

      setHeader(event, 'Cache-Control', 'no-store')
      return {
        access_token: tokenSet.accessToken,
        id_token: tokenSet.idToken,
        refresh_token: tokenSet.refreshToken || undefined,
        token_type: tokenSet.tokenType,
        expires_in: tokenSet.expiresIn
      }
    }

    if (grantType === 'client_credentials') {
      const clientId = stringValue(body.client_id) || basicCredentials.clientId
      const clientSecret = stringValue(body.client_secret) || basicCredentials.clientSecret
      const serviceClient = clientSecret
        ? await consumeServiceClientCredentials({
            clientId,
            clientSecret,
            audience: body.audience,
            scope: body.scope
          })
        : await consumeRuntimeAppIdentity({
            event,
            appCode: body.app_code,
            clientId,
            audience: body.audience,
            scope: body.scope
          })
      const token = await issueServiceAccessToken({
        event,
        audience: stringValue(body.audience),
        scope: serviceClient.scope,
        serviceClient
      })

      await writeTokenEvent(event, {
        eventType: 'issue_service',
        clientId: serviceClient.clientId,
        uid: null,
        sessionHash: null,
        result: 'success'
      })

      setHeader(event, 'Cache-Control', 'no-store')
      return {
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: serviceClient.scope
      }
    }
  } catch (error) {
    await writeTokenEvent(event, {
      eventType: grantType === 'refresh_token'
        ? 'refresh'
        : grantType === 'client_credentials'
          ? 'issue_service'
          : 'issue',
      clientId: stringValue(body.client_id) || basicCredentials.clientId || null,
      tokenHash: body.refresh_token ? hashOpaqueValue(stringValue(body.refresh_token)) : null,
      result: 'failed',
      failureReason: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined)
    throw error
  }

  throw createError({ statusCode: 400, message: 'unsupported_grant_type' })
})
