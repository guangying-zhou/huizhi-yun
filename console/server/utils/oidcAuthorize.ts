import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from './db'
import type { ConsoleSessionContext } from './authSession'

const OIDC_SUPPORTED_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access'])

interface AuthClientRow extends RowDataPacket {
  id: number
  clientId: string
  clientName: string
  appCode: string | null
  clientType: string
  authMode: string
  homeUrl: string | null
  logoutUrl: string | null
  status: string
}

interface RedirectUriRow extends RowDataPacket {
  id: number
}

export interface OidcAuthorizeClient {
  id: number
  clientId: string
  clientName: string
  appCode: string | null
  clientType: string
  authMode: string
  homeUrl: string | null
  logoutUrl: string | null
  status: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberConfig(value: unknown, fallback: number) {
  const parsed = Number(value || fallback)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function toSqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000)
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

async function findOidcClient(clientId: string) {
  const row = await queryRow<AuthClientRow>(
    `SELECT id,
            client_id AS clientId,
            client_name AS clientName,
            app_code AS appCode,
            client_type AS clientType,
            auth_mode AS authMode,
            home_url AS homeUrl,
            logout_url AS logoutUrl,
            status
       FROM auth_clients
      WHERE client_id = ?
        AND status = 'active'
      LIMIT 1`,
    [clientId]
  )
  if (!row) return null

  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    appCode: row.appCode,
    clientType: row.clientType,
    authMode: row.authMode,
    homeUrl: row.homeUrl,
    logoutUrl: row.logoutUrl,
    status: row.status
  } satisfies OidcAuthorizeClient
}

export async function requireAuthorizeOidcClient(clientId: unknown) {
  const normalized = stringValue(clientId)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'invalid_client: client_id is required' })
  }

  const client = await findOidcClient(normalized)
  if (!client) {
    throw createError({ statusCode: 400, message: `invalid_client: ${normalized}` })
  }

  if (client.authMode && !['oidc', 'mixed'].includes(client.authMode)) {
    throw createError({ statusCode: 400, message: `invalid_client: client auth_mode is ${client.authMode}` })
  }

  return client
}

export async function assertAuthorizeRedirectUri(client: OidcAuthorizeClient, redirectUri: unknown, uriType: 'redirect' | 'post_logout' = 'redirect') {
  const normalized = stringValue(redirectUri)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'invalid_request: redirect_uri is required' })
  }

  const row = await queryRow<RedirectUriRow>(
    `SELECT id
       FROM auth_client_redirect_uris
      WHERE client_id = ?
        AND uri_type = ?
        AND redirect_uri = ?
        AND status = 'active'
      LIMIT 1`,
    [client.id, uriType, normalized]
  )

  if (!row) {
    throw createError({ statusCode: 400, message: 'invalid_redirect_uri' })
  }

  return normalized
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

  return {
    codeChallenge,
    codeChallengeMethod
  }
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
  const expiresAt = addSeconds(getAuthorizationCodeTtl(input.event))

  await execute(
    `INSERT INTO auth_authorization_codes (
       code_hash,
       client_id,
       session_id,
       uid,
       redirect_uri,
       scope,
       state_hash,
       nonce_hash,
       nonce,
       code_challenge,
       code_challenge_method,
       issued_at,
       expires_at,
       status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, 'active')`,
    [
      hashOpaqueValue(code),
      input.client.id,
      input.session.sessionPk,
      input.session.uid,
      input.redirectUri,
      input.scope,
      input.state ? hashOpaqueValue(input.state) : null,
      input.nonce ? hashOpaqueValue(input.nonce) : null,
      input.nonce || null,
      input.codeChallenge,
      input.codeChallengeMethod,
      toSqlDateTime(expiresAt)
    ]
  )

  return code
}
