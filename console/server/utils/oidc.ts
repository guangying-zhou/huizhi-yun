import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'
import type { JWTPayload, JWK } from 'jose'
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from 'jose'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'
import { resolveCurrentAppHomeUrl } from '@hzy/foundation/server/utils/appUrls'
import { readCachedBundle } from '~~/server/utils/bundleCache'
import { execute, queryRow, queryRows } from '~~/server/utils/db'
import { loadPlatformRuntimeConfig, resolvePlatformRuntimeCacheScope } from '~~/server/utils/platformRuntime'
import type { ConsoleSessionContext } from '~~/server/utils/authSession'

export const OIDC_SUPPORTED_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access'])

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

interface SigningKeyRow extends RowDataPacket {
  id: number
  kid: string
  alg: string
  useType: string
  publicJwkJson: string | Record<string, unknown>
  privateKeyRef: string | null
  status: string
}

type CloudflareEnv = Record<string, unknown>
type CloudflareGlobal = typeof globalThis & {
  __env__?: CloudflareEnv
}
type CloudflareRuntimeEvent = H3Event & {
  context?: {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
    nitro?: {
      env?: CloudflareEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}

interface AuthorizationCodeRow extends RowDataPacket {
  id: number
  clientPk: number
  clientId: string
  clientName: string
  appCode: string | null
  clientStatus: string
  sessionPk: number
  uid: string
  redirectUri: string
  scope: string
  nonce: string | null
  nonceHash: string | null
  codeChallenge: string
  codeChallengeMethod: string
  expiresAt: string
  sessionStoredId: string
  sessionStatus: string
  sessionRevokedAt: string | null
  sessionExpiresAt: string
  identityId: number | null
  authProvider: string
  username: string | null
  displayName: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4: string | null
  avatarUrl: string | null
  primaryDeptCode: string | null
  primaryDeptName: string | null
  positionTitle: string | null
  userType: string
}

interface RefreshTokenRow extends RowDataPacket {
  id: number
  tokenFamily: string
  clientPk: number
  clientId: string
  clientName: string
  appCode: string | null
  sessionPk: number
  uid: string
  expiresAt: string
  sessionStoredId: string
  sessionStatus: string
  sessionRevokedAt: string | null
  sessionExpiresAt: string
  identityId: number | null
  authProvider: string
  username: string | null
  displayName: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4: string | null
  avatarUrl: string | null
  primaryDeptCode: string | null
  primaryDeptName: string | null
  positionTitle: string | null
  userType: string
}

export interface OidcClient {
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

export interface TokenIssueInput {
  event: H3Event
  client: OidcClient
  session: ConsoleSessionContext
  scope: string
  nonce?: string | null
  issueRefreshToken?: boolean
  refreshTokenFamily?: string | null
}

export interface TokenSet {
  accessToken: string
  idToken: string
  refreshToken: string | null
  expiresIn: number
  tokenType: 'Bearer'
}

export interface ServiceAccessTokenInput {
  event: H3Event
  audience: string
  scope: string
  serviceClient: {
    clientId: string
    clientCode: string
    clientName: string
    clientType: string
    appCode: string | null
    credentialId: number
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function numberConfig(value: unknown, fallback: number) {
  const parsed = Number(value || fallback)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function booleanEnv(event: H3Event, key: string, fallback: boolean) {
  const normalized = runtimeEnvValue(event, key).toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function toSqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000)
}

export function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

export function hashOpaqueValue(value: string) {
  return `sha256_${createHash('sha256').update(value).digest('hex')}`
}

export function createAuthorizationCode() {
  return `hzy_ac_${randomBytes(32).toString('base64url')}`
}

export function createRefreshToken() {
  return `hzy_rt_${randomBytes(48).toString('base64url')}`
}

export function createTokenFamily() {
  return `hzy_rtf_${randomBytes(24).toString('base64url')}`
}

export function normalizeScope(scope: unknown) {
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

export function getOidcTtl(event: H3Event, key: 'authorizationCodeTtlSeconds' | 'accessTokenTtlSeconds' | 'refreshTokenTtlSeconds') {
  const config = useRuntimeConfig(event)
  const fallback = key === 'authorizationCodeTtlSeconds' ? 300 : key === 'accessTokenTtlSeconds' ? 900 : 2592000
  return numberConfig(config.auth?.[key], fallback)
}

export function getOidcIssuer(event: H3Event) {
  const config = useRuntimeConfig(event)
  const configured = stringValue(config.auth?.oidcIssuer || process.env.CONSOLE_OIDC_ISSUER)
  if (configured) return configured.replace(/\/$/, '')

  const publicServiceUrl = stringValue(config.public?.serviceUrl)
  if (publicServiceUrl) return publicServiceUrl.replace(/\/$/, '')

  return resolveCurrentAppHomeUrl(event).replace(/\/$/, '')
}

function getSigningKeyDir(event: H3Event) {
  const config = useRuntimeConfig(event)
  const configured = stringValue(config.auth?.signingKeyDir || process.env.CONSOLE_AUTH_SIGNING_KEY_DIR || '.data/auth-runtime/signing-keys')
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
}

function getCloudflareEnv(event: H3Event): CloudflareEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__env__
    || {}
}

function runtimeEnvValue(event: H3Event, key: string) {
  const value = stringValue(process.env[key])
  if (value) return value

  return stringValue(getCloudflareEnv(event)[key])
}

function isCloudflareRuntime(event: H3Event) {
  return runtimeEnvValue(event, 'HZY_CLOUDFLARE_RUNTIME') === 'true'
    || runtimeEnvValue(event, 'HZY_CLOUDFLARE_BUILD') === 'true'
}

function jsonStringify(value: unknown) {
  return JSON.stringify(value)
}

function parseJwk(value: string | Record<string, unknown>): JWK {
  if (typeof value === 'string') {
    return JSON.parse(value) as JWK
  }
  return value as JWK
}

function publicJwkFromPrivate(row: SigningKeyRow, privateJwk: JWK): JWK {
  const kty = stringValue(privateJwk.kty)
  const crv = stringValue(privateJwk.crv)
  const x = stringValue(privateJwk.x)

  if (!kty || !crv || !x) {
    throw new Error(`signing key ${row.kid} private JWK is missing public key material`)
  }

  return {
    kty,
    crv,
    x,
    kid: row.kid,
    alg: row.alg,
    use: row.useType
  }
}

function publicJwkMatchesPrivate(row: SigningKeyRow, privateJwk: JWK) {
  const stored = parseJwk(row.publicJwkJson)
  const derived = publicJwkFromPrivate(row, privateJwk)
  return stringValue(stored.kty) === stringValue(derived.kty)
    && stringValue(stored.crv) === stringValue(derived.crv)
    && stringValue(stored.x) === stringValue(derived.x)
}

async function repairEnvSigningKeyPublicJwk(row: SigningKeyRow, privateJwk: JWK) {
  if (!stringValue(row.privateKeyRef).startsWith('env:')) {
    throw new Error(`signing key ${row.kid} public/private material mismatch`)
  }

  const publicJwk = publicJwkFromPrivate(row, privateJwk)
  await execute(
    `UPDATE auth_signing_keys
        SET public_jwk_json = CAST(? AS JSON),
            updated_at = UTC_TIMESTAMP()
      WHERE id = ?
        AND kid = ?`,
    [jsonStringify(publicJwk), row.id, row.kid]
  )
  console.warn(`[OIDC] repaired published public JWK for env-backed signing key ${row.kid}`)
}

function signingKeyPath(event: H3Event, kid: string) {
  return resolve(getSigningKeyDir(event), `${kid}.private.jwk`)
}

async function writePrivateJwk(event: H3Event, kid: string, privateJwk: JWK) {
  const dir = getSigningKeyDir(event)
  await mkdir(dir, { recursive: true })
  const path = signingKeyPath(event, kid)
  await writeFile(path, JSON.stringify(privateJwk, null, 2), { encoding: 'utf8', mode: 0o600 })
  return pathToFileURL(path).toString()
}

async function readPrivateJwk(event: H3Event, ref: string) {
  if (ref.startsWith('env:')) {
    const envName = ref.slice('env:'.length).trim()
    const value = envName ? runtimeEnvValue(event, envName) : ''
    if (!value) {
      throw new Error(`signing key env ${envName} is not configured`)
    }
    return JSON.parse(value) as JWK
  }

  if (!ref.startsWith('file://')) {
    throw new Error(`unsupported signing key ref: ${ref}`)
  }
  const path = fileURLToPath(ref)
  return JSON.parse(await readFile(path, 'utf8')) as JWK
}

async function generateSigningKey(event: H3Event) {
  if (isCloudflareRuntime(event)) {
    throw new Error(
      'Cloudflare Console runtime requires a pre-provisioned OIDC signing key. '
      + 'Generate one with console/scripts/generate-cloudflare-oidc-key.mjs, store the private JWK as a Worker secret, '
      + 'and insert auth_signing_keys.private_key_ref as env:CONSOLE_AUTH_SIGNING_PRIVATE_JWK.'
    )
  }

  const kid = `csk_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${randomBytes(6).toString('base64url')}`
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)
  const decoratedPublicJwk = {
    ...publicJwk,
    kid,
    alg: 'EdDSA',
    use: 'sig'
  }
  const privateKeyRef = await writePrivateJwk(event, kid, {
    ...privateJwk,
    kid,
    alg: 'EdDSA',
    use: 'sig'
  })

  await execute(
    `UPDATE auth_signing_keys
        SET status = 'retired',
            updated_at = UTC_TIMESTAMP()
      WHERE status = 'current'`,
    []
  )

  await execute(
    `INSERT INTO auth_signing_keys (
       kid,
       alg,
       use_type,
       public_jwk_json,
       private_key_ref,
       not_before,
       status
     ) VALUES (?, 'EdDSA', 'sig', CAST(? AS JSON), ?, UTC_TIMESTAMP(), 'current')`,
    [kid, jsonStringify(decoratedPublicJwk), privateKeyRef]
  )

  return {
    kid,
    alg: 'EdDSA',
    publicJwk: decoratedPublicJwk,
    privateKeyRef
  }
}

async function findCurrentSigningKey() {
  return queryRow<SigningKeyRow>(
    `SELECT id,
            kid,
            alg,
            use_type AS useType,
            public_jwk_json AS publicJwkJson,
            private_key_ref AS privateKeyRef,
            status
       FROM auth_signing_keys
      WHERE status = 'current'
        AND (not_before IS NULL OR not_before <= UTC_TIMESTAMP())
        AND (not_after IS NULL OR not_after > UTC_TIMESTAMP())
      ORDER BY id DESC
      LIMIT 1`
  )
}

export async function ensureCurrentSigningKey(event: H3Event) {
  const existing = await findCurrentSigningKey()
  if (existing?.privateKeyRef) {
    try {
      const privateJwk = await readPrivateJwk(event, existing.privateKeyRef)
      if (!publicJwkMatchesPrivate(existing, privateJwk)) {
        await repairEnvSigningKeyPublicJwk(existing, privateJwk)
      }
      const key = await importJWK(privateJwk, existing.alg)
      return {
        kid: existing.kid,
        alg: existing.alg,
        key
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!booleanEnv(event, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', false)) {
        throw new Error(
          `current OIDC signing key ${existing.kid} is not usable and automatic rotation is disabled: ${message}. `
          + 'Configure the private key referenced by auth_signing_keys.private_key_ref, '
          + 'or set CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=true only for an isolated Console DB.'
        )
      }
      console.warn(`[OIDC] current signing key is not usable, rotating because CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=true: ${message}`)
    }
  }

  if (!booleanEnv(event, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', false)) {
    throw new Error(
      'Console OIDC signing key is not provisioned and automatic generation is disabled. '
      + 'Provision auth_signing_keys with console/scripts/generate-cloudflare-oidc-key.mjs and configure the referenced private key, '
      + 'or set CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE=true only for an isolated local Console DB.'
    )
  }

  const generated = await generateSigningKey(event)
  const privateJwk = await readPrivateJwk(event, generated.privateKeyRef)
  const key = await importJWK(privateJwk, generated.alg)
  return {
    kid: generated.kid,
    alg: generated.alg,
    key
  }
}

export async function getPublishedJwks() {
  const rows = await queryRows<SigningKeyRow[]>(
    `SELECT id,
            kid,
            alg,
            use_type AS useType,
            public_jwk_json AS publicJwkJson,
            private_key_ref AS privateKeyRef,
            status
       FROM auth_signing_keys
      WHERE status IN ('current', 'next', 'retired')
        AND (not_before IS NULL OR not_before <= UTC_TIMESTAMP())
        AND (not_after IS NULL OR not_after > UTC_TIMESTAMP())
      ORDER BY FIELD(status, 'current', 'next', 'retired'), id DESC`
  )

  return {
    keys: rows.map((row) => {
      const jwk = parseJwk(row.publicJwkJson)
      return {
        ...jwk,
        kid: row.kid,
        alg: row.alg,
        use: row.useType || 'sig'
      }
    })
  }
}

export async function findOidcClient(clientId: string) {
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
  } satisfies OidcClient
}

export async function requireOidcClient(clientId: unknown) {
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

export async function assertRedirectUri(client: OidcClient, redirectUri: unknown, uriType: 'redirect' | 'post_logout' = 'redirect') {
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

export function assertPkce(input: { codeChallenge: unknown, codeChallengeMethod: unknown }) {
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

function buildSessionContext(row: AuthorizationCodeRow | RefreshTokenRow): ConsoleSessionContext {
  return {
    sessionPk: row.sessionPk,
    sessionId: '',
    storedSessionId: row.sessionStoredId,
    uid: row.uid,
    identityId: row.identityId,
    authProvider: row.authProvider,
    issuedAt: '',
    lastSeenAt: null,
    expiresAt: row.sessionExpiresAt,
    user: {
      uid: row.uid,
      username: row.username,
      displayName: row.displayName,
      realName: row.realName || row.displayName || row.username || row.uid,
      nickname: row.nickname,
      email: row.email,
      mobile: row.mobile,
      mobileTail4: row.mobileTail4,
      avatar: row.avatarUrl,
      avatarUrl: row.avatarUrl,
      primaryDeptCode: row.primaryDeptCode,
      primaryDeptName: row.primaryDeptName,
      deptCode: row.primaryDeptCode,
      deptName: row.primaryDeptName,
      positionTitle: row.positionTitle,
      userType: row.userType
    },
    identity: {
      providerCode: null,
      providerSubject: null
    }
  }
}

function buildClient(row: AuthorizationCodeRow | RefreshTokenRow): OidcClient {
  return {
    id: row.clientPk,
    clientId: row.clientId,
    clientName: row.clientName,
    appCode: row.appCode,
    clientType: 'public',
    authMode: 'oidc',
    homeUrl: null,
    logoutUrl: null,
    status: 'active'
  }
}

export async function createAuthorizationCodeRecord(input: {
  event: H3Event
  client: OidcClient
  session: ConsoleSessionContext
  redirectUri: string
  scope: string
  state?: string | null
  nonce?: string | null
  codeChallenge: string
  codeChallengeMethod: string
}) {
  const code = createAuthorizationCode()
  const expiresAt = addSeconds(getOidcTtl(input.event, 'authorizationCodeTtlSeconds'))

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

async function loadAuthorizationCode(code: string) {
  return queryRow<AuthorizationCodeRow>(
    `SELECT ac.id,
            ac.client_id AS clientPk,
            c.client_id AS clientId,
            c.client_name AS clientName,
            c.app_code AS appCode,
            c.status AS clientStatus,
            ac.session_id AS sessionPk,
            ac.uid,
            ac.redirect_uri AS redirectUri,
            ac.scope,
            ac.nonce,
            ac.nonce_hash AS nonceHash,
            ac.code_challenge AS codeChallenge,
            ac.code_challenge_method AS codeChallengeMethod,
            ac.expires_at AS expiresAt,
            ls.session_id AS sessionStoredId,
            ls.status AS sessionStatus,
            ls.revoked_at AS sessionRevokedAt,
            ls.expires_at AS sessionExpiresAt,
            ls.identity_id AS identityId,
            ls.auth_provider AS authProvider,
            u.username,
            u.display_name AS displayName,
            u.real_name AS realName,
            u.nickname,
            u.email,
            u.mobile,
            u.mobile_tail4 AS mobileTail4,
            u.avatar_url AS avatarUrl,
            pd.dept_code AS primaryDeptCode,
            pd.dept_name AS primaryDeptName,
            u.position_title AS positionTitle,
            u.user_type AS userType
       FROM auth_authorization_codes ac
       INNER JOIN auth_clients c ON c.id = ac.client_id
       INNER JOIN local_sessions ls ON ls.id = ac.session_id
       INNER JOIN directory_users u ON u.uid = ac.uid AND u.status = 'active'
       LEFT JOIN (
         SELECT ranked.uid, ranked.dept_code, ranked.dept_name
         FROM (
           SELECT ud.uid,
                  ud.dept_code,
                  d.dept_name,
                  ROW_NUMBER() OVER (
                    PARTITION BY ud.uid
                    ORDER BY ud.is_primary DESC, d.sort_order ASC, d.id ASC, ud.id ASC
                  ) AS row_no
             FROM directory_user_departments ud
             INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
            WHERE ud.status = 'active'
              AND ud.relation_type = 'member'
              AND d.status = 'active'
              AND d.org_type = 'department'
         ) ranked
         WHERE ranked.row_no = 1
       ) pd ON pd.uid = u.uid
      WHERE ac.code_hash = ?
        AND ac.status = 'active'
        AND ac.consumed_at IS NULL
        AND ac.expires_at > UTC_TIMESTAMP()
        AND c.status = 'active'
        AND ls.status = 'active'
        AND ls.revoked_at IS NULL
        AND ls.expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [hashOpaqueValue(code)]
  )
}

export async function consumeAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}) {
  const code = stringValue(input.code)
  const codeVerifier = stringValue(input.codeVerifier)
  if (!code || !codeVerifier) {
    throw createError({ statusCode: 400, message: 'invalid_grant: code and code_verifier are required' })
  }

  const row = await loadAuthorizationCode(code)
  if (!row) {
    throw createError({ statusCode: 400, message: 'invalid_grant: authorization code is invalid or expired' })
  }

  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) {
    throw createError({ statusCode: 400, message: 'invalid_grant: client_id or redirect_uri mismatch' })
  }

  if (sha256Base64Url(codeVerifier) !== row.codeChallenge) {
    throw createError({ statusCode: 400, message: 'invalid_grant: PKCE verification failed' })
  }

  const consumed = await execute<ResultSetHeader>(
    `UPDATE auth_authorization_codes
        SET status = 'consumed',
            consumed_at = UTC_TIMESTAMP()
      WHERE id = ?
        AND status = 'active'
        AND consumed_at IS NULL`,
    [row.id]
  )
  if (consumed.affectedRows !== 1) {
    throw createError({ statusCode: 400, message: 'invalid_grant: authorization code was already consumed' })
  }

  return {
    client: buildClient(row),
    session: buildSessionContext(row),
    scope: row.scope,
    nonce: row.nonce
  }
}

async function loadRefreshToken(token: string) {
  return queryRow<RefreshTokenRow>(
    `SELECT rt.id,
            rt.token_family AS tokenFamily,
            rt.client_id AS clientPk,
            c.client_id AS clientId,
            c.client_name AS clientName,
            c.app_code AS appCode,
            rt.session_id AS sessionPk,
            rt.uid,
            rt.expires_at AS expiresAt,
            ls.session_id AS sessionStoredId,
            ls.status AS sessionStatus,
            ls.revoked_at AS sessionRevokedAt,
            ls.expires_at AS sessionExpiresAt,
            ls.identity_id AS identityId,
            ls.auth_provider AS authProvider,
            u.username,
            u.display_name AS displayName,
            u.real_name AS realName,
            u.nickname,
            u.email,
            u.mobile,
            u.mobile_tail4 AS mobileTail4,
            u.avatar_url AS avatarUrl,
            pd.dept_code AS primaryDeptCode,
            pd.dept_name AS primaryDeptName,
            u.position_title AS positionTitle,
            u.user_type AS userType
       FROM auth_refresh_tokens rt
       INNER JOIN auth_clients c ON c.id = rt.client_id
       INNER JOIN local_sessions ls ON ls.id = rt.session_id
       INNER JOIN directory_users u ON u.uid = rt.uid AND u.status = 'active'
       LEFT JOIN (
         SELECT ranked.uid, ranked.dept_code, ranked.dept_name
         FROM (
           SELECT ud.uid,
                  ud.dept_code,
                  d.dept_name,
                  ROW_NUMBER() OVER (
                    PARTITION BY ud.uid
                    ORDER BY ud.is_primary DESC, d.sort_order ASC, d.id ASC, ud.id ASC
                  ) AS row_no
             FROM directory_user_departments ud
             INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
            WHERE ud.status = 'active'
              AND ud.relation_type = 'member'
              AND d.status = 'active'
              AND d.org_type = 'department'
         ) ranked
         WHERE ranked.row_no = 1
       ) pd ON pd.uid = u.uid
      WHERE rt.token_hash = ?
        AND c.status = 'active'
      LIMIT 1`,
    [hashOpaqueValue(token)]
  )
}

export async function consumeRefreshToken(event: H3Event, token: string, clientId: string) {
  const normalizedToken = stringValue(token)
  if (!normalizedToken) {
    throw createError({ statusCode: 400, message: 'invalid_grant: refresh_token is required' })
  }

  const row = await loadRefreshToken(normalizedToken)
  if (!row) {
    throw createError({ statusCode: 400, message: 'invalid_grant: refresh token is invalid' })
  }

  if (row.clientId !== clientId) {
    throw createError({ statusCode: 400, message: 'invalid_grant: client_id mismatch' })
  }

  const status = await queryRow<RowDataPacket & { status: string, tokenFamily: string }>(
    `SELECT status, token_family AS tokenFamily
       FROM auth_refresh_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [hashOpaqueValue(normalizedToken)]
  )

  if (!status || status.status !== 'active') {
    if (status?.tokenFamily) {
      await execute(
        `UPDATE auth_refresh_tokens
            SET status = 'revoked',
                reuse_detected_at = CASE WHEN token_hash = ? THEN UTC_TIMESTAMP() ELSE reuse_detected_at END,
                revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
          WHERE token_family = ?
            AND status IN ('active', 'rotated')`,
        [hashOpaqueValue(normalizedToken), status.tokenFamily]
      )
      await writeTokenEvent(event, {
        eventType: 'reuse_detected',
        clientId,
        uid: row.uid,
        sessionHash: row.sessionStoredId,
        tokenHash: hashOpaqueValue(normalizedToken),
        result: 'failed',
        failureReason: 'refresh token reuse detected'
      })
    }
    throw createError({ statusCode: 400, message: 'invalid_grant: refresh token is not active' })
  }

  if (new Date(`${row.expiresAt}Z`).getTime() <= Date.now()) {
    await execute(
      `UPDATE auth_refresh_tokens
          SET status = 'expired'
        WHERE id = ?
          AND status = 'active'`,
      [row.id]
    )
    throw createError({ statusCode: 400, message: 'invalid_grant: refresh token expired' })
  }

  if (row.sessionStatus !== 'active' || row.sessionRevokedAt || new Date(`${row.sessionExpiresAt}Z`).getTime() <= Date.now()) {
    throw createError({ statusCode: 400, message: 'invalid_grant: session revoked or expired' })
  }

  const rotated = await execute<ResultSetHeader>(
    `UPDATE auth_refresh_tokens
        SET status = 'rotated',
            rotated_at = UTC_TIMESTAMP()
      WHERE id = ?
        AND status = 'active'`,
    [row.id]
  )
  if (rotated.affectedRows !== 1) {
    throw createError({ statusCode: 400, message: 'invalid_grant: refresh token was already used' })
  }

  return {
    client: buildClient(row),
    session: buildSessionContext(row),
    tokenFamily: row.tokenFamily
  }
}

async function loadPolicyDigest(event: H3Event) {
  try {
    const config = loadPlatformRuntimeConfig(event)
    const bundle = await readCachedBundle(config.bundleCacheDir, resolvePlatformRuntimeCacheScope(config, event))
    return {
      tenantCode: bundle?.tenantCode || config.tenantCode,
      deploymentCode: bundle?.deploymentCode || config.deploymentCode,
      policyVersion: bundle?.bundleVersion || null,
      caps: bundle?.bundleHash || null
    }
  } catch {
    return {
      tenantCode: null,
      deploymentCode: null,
      policyVersion: null,
      caps: null
    }
  }
}

function buildDirectorySnapshot(session: ConsoleSessionContext) {
  return hashOpaqueValue([
    'directory',
    session.uid,
    session.user.primaryDeptCode || session.user.deptCode || '',
    session.user.positionTitle || '',
    session.user.userType || ''
  ].join('|'))
}

async function signJwt(input: {
  event: H3Event
  client: OidcClient
  session: ConsoleSessionContext
  scope: string
  tokenUse: 'access' | 'id'
  nonce?: string | null
  expiresIn: number
}) {
  const signingKey = await ensureCurrentSigningKey(input.event)
  const issuer = getOidcIssuer(input.event)
  const now = Math.floor(Date.now() / 1000)
  const policy = await loadPolicyDigest(input.event)
  const subject = `user:${input.session.uid}`

  const claims: JWTPayload & Record<string, unknown> = {
    iss: issuer,
    sub: subject,
    aud: input.client.clientId,
    tenant: policy.tenantCode,
    deployment: policy.deploymentCode,
    sid: input.session.storedSessionId,
    policy_ver: policy.policyVersion,
    caps: policy.caps,
    token_use: input.tokenUse,
    hzy: {
      uid: input.session.uid,
      subjectType: 'user',
      subjectCode: input.session.uid,
      directorySnapshot: buildDirectorySnapshot(input.session)
    }
  }

  if (input.tokenUse === 'id' && input.nonce) {
    claims.nonce = input.nonce
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: signingKey.alg, kid: signingKey.kid, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + input.expiresIn)
    .sign(signingKey.key)
}

async function signServiceAccessJwt(input: ServiceAccessTokenInput & { expiresIn: number }) {
  const signingKey = await ensureCurrentSigningKey(input.event)
  const issuer = getOidcIssuer(input.event)
  const now = Math.floor(Date.now() / 1000)
  const policy = await loadPolicyDigest(input.event)

  const claims: JWTPayload & Record<string, unknown> = {
    iss: issuer,
    sub: `client:${input.serviceClient.clientCode}`,
    aud: input.audience,
    azp: input.serviceClient.clientId,
    client_id: input.serviceClient.clientId,
    scope: input.scope,
    tenant: policy.tenantCode,
    deployment: policy.deploymentCode,
    policy_ver: policy.policyVersion,
    caps: policy.caps,
    token_use: 'service',
    hzy: {
      subjectType: 'service',
      subjectCode: input.serviceClient.clientCode,
      clientCode: input.serviceClient.clientCode,
      clientName: input.serviceClient.clientName,
      clientType: input.serviceClient.clientType,
      appCode: input.serviceClient.appCode,
      credentialId: input.serviceClient.credentialId
    }
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: signingKey.alg, kid: signingKey.kid, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + input.expiresIn)
    .sign(signingKey.key)
}

export async function issueTokenSet(input: TokenIssueInput): Promise<TokenSet> {
  const expiresIn = getOidcTtl(input.event, 'accessTokenTtlSeconds')
  const [accessToken, idToken] = await Promise.all([
    signJwt({ ...input, tokenUse: 'access', expiresIn }),
    signJwt({ ...input, tokenUse: 'id', expiresIn })
  ])

  let refreshToken: string | null = null
  if (input.issueRefreshToken) {
    refreshToken = createRefreshToken()
    await execute(
      `INSERT INTO auth_refresh_tokens (
         token_hash,
         token_family,
         client_id,
         session_id,
         uid,
         issued_at,
         expires_at,
         status
       ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, 'active')`,
      [
        hashOpaqueValue(refreshToken),
        input.refreshTokenFamily || createTokenFamily(),
        input.client.id,
        input.session.sessionPk,
        input.session.uid,
        toSqlDateTime(addSeconds(getOidcTtl(input.event, 'refreshTokenTtlSeconds')))
      ]
    )
  }

  return {
    accessToken,
    idToken,
    refreshToken,
    expiresIn,
    tokenType: 'Bearer'
  }
}

export async function issueServiceAccessToken(input: ServiceAccessTokenInput) {
  const expiresIn = getOidcTtl(input.event, 'accessTokenTtlSeconds')
  return {
    accessToken: await signServiceAccessJwt({ ...input, expiresIn }),
    expiresIn,
    tokenType: 'Bearer' as const
  }
}

export async function verifyAccessToken(event: H3Event, token: string) {
  const jwks = await getPublishedJwks()
  const keySet = new Map<string, JWK>(jwks.keys.map(key => [stringValue(key.kid), key]))
  const header = JSON.parse(Buffer.from(token.split('.')[0] || '', 'base64url').toString('utf8')) as { kid?: string, alg?: string }
  const jwk = header.kid ? keySet.get(header.kid) : null
  if (!jwk) {
    throw createError({ statusCode: 401, message: 'invalid_token: signing key not found' })
  }

  const key = await importJWK(jwk, header.alg || 'EdDSA')
  const { payload } = await jwtVerify(token, key, {
    issuer: getOidcIssuer(event)
  })

  if (payload.token_use !== 'access') {
    throw createError({ statusCode: 401, message: 'invalid_token: access token required' })
  }

  const sid = stringValue(payload.sid)
  if (!sid) {
    throw createError({ statusCode: 401, message: 'invalid_token: sid missing' })
  }

  const session = await queryRow<RowDataPacket & { id: number }>(
    `SELECT id
       FROM local_sessions
      WHERE session_id = ?
        AND status = 'active'
        AND revoked_at IS NULL
        AND expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [sid]
  )
  if (!session) {
    throw createError({ statusCode: 401, message: 'invalid_token: session revoked or expired' })
  }

  return payload
}

export async function revokeRefreshToken(token: string) {
  const normalized = stringValue(token)
  if (!normalized) return false

  const row = await queryRow<RowDataPacket & { tokenFamily: string }>(
    `SELECT token_family AS tokenFamily
       FROM auth_refresh_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [hashOpaqueValue(normalized)]
  )
  if (row?.tokenFamily) {
    const result = await execute<ResultSetHeader>(
      `UPDATE auth_refresh_tokens
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
        WHERE token_family = ?
          AND status IN ('active', 'rotated')`,
      [row.tokenFamily]
    )
    return result.affectedRows > 0
  }

  const result = await execute<ResultSetHeader>(
    `UPDATE auth_refresh_tokens
        SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
      WHERE token_hash = ?
        AND status = 'active'`,
    [hashOpaqueValue(normalized)]
  )

  return result.affectedRows > 0
}

async function revokeRefreshTokensBySessionHash(sessionHash: string) {
  await execute(
    `UPDATE auth_refresh_tokens rt
     INNER JOIN local_sessions ls ON ls.id = rt.session_id
        SET rt.status = 'revoked',
            rt.revoked_at = COALESCE(rt.revoked_at, UTC_TIMESTAMP())
      WHERE ls.session_id = ?
        AND rt.status IN ('active', 'rotated')`,
    [sessionHash]
  )
}

export async function revokeAccessTokenSession(event: H3Event, token: string) {
  const payload = await verifyAccessToken(event, token)
  const sid = stringValue(payload.sid)
  if (!sid) return false

  await revokeRefreshTokensBySessionHash(sid)

  const result = await execute<ResultSetHeader>(
    `UPDATE local_sessions
        SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
            updated_at = UTC_TIMESTAMP()
      WHERE session_id = ?
        AND status = 'active'`,
    [sid]
  )

  return result.affectedRows > 0
}

export async function revokeRefreshTokenFamily(tokenFamily: string) {
  await execute(
    `UPDATE auth_refresh_tokens
        SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
      WHERE token_family = ?
        AND status = 'active'`,
    [tokenFamily]
  )
}

export async function writeTokenEvent(
  event: H3Event,
  input: {
    eventType: string
    clientId?: string | null
    uid?: string | null
    sessionHash?: string | null
    tokenHash?: string | null
    result?: 'success' | 'failed'
    failureReason?: string | null
  }
) {
  await execute(
    `INSERT INTO auth_token_events (
       event_type,
       client_id,
       uid,
       session_hash,
       token_hash,
       result,
       failure_reason,
       ip_address,
       user_agent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.eventType,
      input.clientId || null,
      input.uid || null,
      input.sessionHash || null,
      input.tokenHash || null,
      input.result || 'success',
      input.failureReason || null,
      stringValue(getHeader(event, 'x-forwarded-for')).split(',')[0] || event.node.req.socket.remoteAddress || null,
      stringValue(getHeader(event, 'user-agent')).slice(0, 500) || null
    ]
  )
}

export async function getUserinfoForPayload(payload: JWTPayload) {
  const uid = nullableString((payload.hzy as { uid?: unknown } | undefined)?.uid) || stringValue(payload.sub).replace(/^user:/, '')
  if (!uid) {
    throw createError({ statusCode: 401, message: 'invalid_token: uid missing' })
  }

  return {
    sub: `user:${uid}`,
    uid,
    tenant: nullableString(payload.tenant)
  }
}
