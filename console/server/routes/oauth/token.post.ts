import type { H3Event } from 'h3'
import { createError, defineEventHandler, getHeader, readBody, readRawBody, setHeader } from 'h3'
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  hashOpaqueValue,
  issueServiceAccessToken,
  issueTokenSet,
  getOidcIssuer,
  getOidcTtl,
  loadOidcPolicyDigest,
  logServiceTokenTimings,
  measureServiceTokenStage,
  requireOidcClient,
  writeTokenEvent
} from '~~/server/utils/oidc'
import {
  consumeRuntimeAppIdentity,
  consumeServiceClientCredentials
} from '~~/server/utils/serviceClients'
import { serviceTokenSourceBindingForCredential } from '~~/server/utils/serviceTokenSourceBinding'
import { exchangeConsoleServiceClientToken, exchangeConsoleGatewayToken } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { authDiagnosticRequestId, logAuthDependencyFailure } from '@hzy/foundation/server/utils/authDependencyDiagnostic'

import { checkedGatewayAssertion, gatewayAssertionLaneEnabled } from '~~/server/utils/gatewayAssertionForwarding'

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
      const client = await requireOidcClient(event, body.client_id)
      const result = await consumeAuthorizationCode({
        event,
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
        expires_in: tokenSet.expiresIn,
        refresh_expires_in: tokenSet.refreshExpiresIn || undefined
      }
    }

    if (grantType === 'refresh_token') {
      const client = await requireOidcClient(event, body.client_id)
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
        expires_in: tokenSet.expiresIn,
        refresh_expires_in: tokenSet.refreshExpiresIn || undefined
      }
    }

    if (grantType === 'client_credentials') {
      const clientId = stringValue(body.client_id) || basicCredentials.clientId
      const clientSecret = stringValue(body.client_secret) || basicCredentials.clientSecret
      if (clientSecret && process.env.HZY_CONSOLE_SERVICE_TOKEN_EXCHANGE_ENABLED === 'true') {
        const policy = await loadOidcPolicyDigest(event)
        if (!policy.policyVersion || !policy.caps) {
          throw createError({ statusCode: 503, message: 'Verified Console policy summary is required for token exchange' })
        }
        const exchanged = await exchangeConsoleServiceClientToken(event, {
          clientId,
          clientSecret,
          audience: stringValue(body.audience),
          scope: stringValue(body.scope),
          issuer: getOidcIssuer(event),
          ttlSeconds: getOidcTtl(event, 'accessTokenTtlSeconds'),
          sourceBinding: 'service-client-policy',
          policyVersion: policy.policyVersion,
          caps: policy.caps
        })
        setHeader(event, 'Cache-Control', 'no-store')
        return {
          access_token: exchanged.data.accessToken,
          token_type: exchanged.data.tokenType,
          expires_in: exchanged.data.expiresIn,
          scope: exchanged.data.scope
        }
      }
      const assertion = String(getHeader(event, 'x-hzy-gateway-service-assertion') || '')
      if (gatewayAssertionLaneEnabled(assertion, clientSecret, process.env.HZY_CONSOLE_GATEWAY_EXCHANGE_ENABLED === 'true')) {
        if (serviceTokenSourceBindingForCredential('', body.source_binding) !== 'trusted-gateway') throw createError({ statusCode: 400, message: 'gateway_exchange_source_binding_invalid' })
        const signedRequest = checkedGatewayAssertion(event, assertion, {
          clientId, audience: stringValue(body.audience), scope: stringValue(body.scope), appCode: stringValue(body.app_code)
        })
        const policy = await loadOidcPolicyDigest(event)
        if (!policy.policyVersion || !policy.caps) throw createError({ statusCode: 503, message: 'gateway_exchange_policy_unavailable' })
        const exchanged = await exchangeConsoleGatewayToken(event, {
          ...signedRequest, issuer: getOidcIssuer(event), ttlSeconds: getOidcTtl(event, 'accessTokenTtlSeconds'),
          policyVersion: policy.policyVersion, caps: policy.caps
        })
        setHeader(event, 'Cache-Control', 'no-store')
        return { access_token: exchanged.data.accessToken, token_type: exchanged.data.tokenType, expires_in: exchanged.data.expiresIn, scope: exchanged.data.scope }
      }
      const identityStartedAt = Date.now()
      let serviceClient
      try {
        serviceClient = await measureServiceTokenStage(event, 'identity', async () => clientSecret
          ? await consumeServiceClientCredentials({
              event,
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
            }))
      } catch (error) {
        logAuthDependencyFailure(event, 'service-identity', error, Date.now() - identityStartedAt)
        throw error
      }
      const issueStartedAt = Date.now()
      let token
      try {
        token = await issueServiceAccessToken({
          event,
          audience: stringValue(body.audience),
          scope: serviceClient.scope,
          // A credential always binds to its verified grant policy. A
          // credential-less Runtime identity may request the same fixed policy
          // only after consumeRuntimeAppIdentity has verified its trusted
          // tenant-gateway app identity; no tenant/deployment value comes from
          // the request body.
          sourceBinding: serviceTokenSourceBindingForCredential(
            clientSecret,
            clientSecret ? undefined : body.source_binding
          ),
          serviceClient
        })
      } catch (error) {
        logAuthDependencyFailure(event, 'service-issue', error, Date.now() - issueStartedAt)
        throw error
      }

      const auditStartedAt = Date.now()
      await measureServiceTokenStage(event, 'audit', () => writeTokenEvent(event, {
        eventType: 'issue_service',
        clientId: serviceClient.clientId,
        uid: null,
        sessionHash: null,
        result: 'success'
      }))
      if (Date.now() - auditStartedAt > 1000) {
        console.warn(JSON.stringify({ event: 'console-auth-audit-slow', requestId: authDiagnosticRequestId(event),
          stage: 'service-token-event', durationMs: Date.now() - auditStartedAt }))
      }

      setHeader(event, 'Cache-Control', 'no-store')
      logServiceTokenTimings(event, clientSecret ? 'credential' : 'gateway')
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
