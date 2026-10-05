import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useRuntimeConfig } from '#imports'
import {
  createConsoleOidcAuthorizationCode,
  resolveConsoleOidcClient,
  type ConsoleOidcClient
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import type { ConsoleSessionContext } from './authSession'

const OIDC_SUPPORTED_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access'])

export type OidcAuthorizeClient = ConsoleOidcClient

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberConfig(value: unknown, fallback: number) {
  const parsed = Number(value || fallback)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function hashOpaqueValue(value: string) {
  return `sha256_${createHash('sha256').update(value).digest('hex')}`
}

function createAuthorizationCode() {
  return `hzy_ac_${randomBytes(32).toString('base64url')}`
}

function getAuthorizationCodeTtl(event: H3Event) {
  const config = useRuntimeConfig(event)
  return numberConfig(config.auth?.authorizationCodeTtlSeconds, 300)
}

export function normalizeAuthorizeScope(scope: unknown) {
  const scopes = [...new Set(stringValue(scope).split(/\s+/).map(item => item.trim()).filter(Boolean))]
  if (!scopes.includes('openid')) {
    throw createError({ statusCode: 400, message: 'invalid_scope: openid is required' })
  }
  const unsupported = scopes.filter(item => !OIDC_SUPPORTED_SCOPES.has(item))
  if (unsupported.length) {
    throw createError({ statusCode: 400, message: `invalid_scope: unsupported scope ${unsupported.join(', ')}` })
  }
  return scopes.sort().join(' ')
}

export async function requireAuthorizeOidcClient(event: H3Event, clientId: unknown) {
  const normalized = stringValue(clientId)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'invalid_client: client_id is required' })
  }
  const response = await resolveConsoleOidcClient(event, { clientId: normalized })
  return response.data
}

export async function assertAuthorizeRedirectUri(
  event: H3Event,
  client: OidcAuthorizeClient,
  redirectUri: unknown,
  uriType: 'redirect' | 'post_logout' = 'redirect'
) {
  const normalized = stringValue(redirectUri)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'invalid_request: redirect_uri is required' })
  }
  const response = await resolveConsoleOidcClient(event, {
    clientId: client.clientId,
    redirectUri: normalized,
    uriType
  })
  return response.data.validatedRedirectUri || normalized
}

export function assertAuthorizePkce(input: { codeChallenge: unknown, codeChallengeMethod: unknown }) {
  const codeChallenge = stringValue(input.codeChallenge)
  const codeChallengeMethod = stringValue(input.codeChallengeMethod)
  if (!codeChallenge || !codeChallengeMethod) {
    throw createError({ statusCode: 400, message: 'invalid_request: PKCE is required' })
  }
  if (codeChallengeMethod !== 'S256') {
    throw createError({ statusCode: 400, message: 'invalid_request: only S256 PKCE is supported' })
  }
  return { codeChallenge, codeChallengeMethod }
}

export async function createAuthorizeCodeRecord(input: {
  event: H3Event
  client: OidcAuthorizeClient
  session: ConsoleSessionContext
  redirectUri: string
  scope: string
  state?: string | null
  nonce?: string | null
  codeChallenge: string
  codeChallengeMethod: string
}) {
  const code = createAuthorizationCode()
  const codeHash = hashOpaqueValue(code)
  await createConsoleOidcAuthorizationCode(input.event, {
    codeHash,
    clientId: input.client.clientId,
    sessionIdHash: input.session.storedSessionId,
    redirectUri: input.redirectUri,
    scope: input.scope,
    stateHash: input.state ? hashOpaqueValue(input.state) : null,
    nonceHash: input.nonce ? hashOpaqueValue(input.nonce) : null,
    nonce: input.nonce || null,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: 'S256',
    ttlSeconds: getAuthorizationCodeTtl(input.event)
  }, `console:oidc-code:${codeHash.slice(-32)}`)
  return code
}
