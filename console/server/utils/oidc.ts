import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'
import type { JWTPayload, JWK } from 'jose'
import { useRuntimeConfig } from '#imports'
import { normalizePublicUrl, resolveCurrentAppHomeUrl } from '@hzy/foundation/server/utils/appUrls'
import {
  appendConsoleOidcTokenEvent,
  consumeConsoleOidcAuthorizationCode,
  consumeConsoleOidcRefreshToken,
  getConsoleOidcPublishedJwks,
  issueConsoleOidcRefreshToken,
  resolveConsoleAuthSession,
  resolveConsoleOidcClient,
  revokeConsoleAuthSession,
  revokeConsoleOidcRefreshTokens,
  signConsoleOidcToken,
  type ConsoleOidcClient,
  type ConsoleRuntimeSession,
  verifyConsoleOidcServiceTokenState
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { readCachedBundle, verifiedPolicyStoreEnabled } from '~~/server/utils/bundleCache'
import { loadPlatformRuntimeConfig, resolvePlatformRuntimeCacheScope } from '~~/server/utils/platformRuntime'
import type { ConsoleSessionContext } from '~~/server/utils/authSession'
import {
  bindServiceAccessTokenPolicyToServiceClient,
  bindServiceAccessTokenPolicyToTrustedSource,
  buildServiceAccessTokenClaims
} from '~~/server/utils/serviceAccessTokenClaims'
import { clampRefreshTokenTtlSeconds } from '~~/server/utils/oidcTokenLifetime'
import { localGatewayIssuer } from '~~/server/utils/localGatewayIssuer'
import { resolveLocalConsoleFacade } from '@hzy/foundation/server/utils/localConsoleFacade'
import { logAuthDependencyFailure } from '@hzy/foundation/server/utils/authDependencyDiagnostic'

export const OIDC_SUPPORTED_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access'])

type JoseModule = typeof import('jose')

let joseModulePromise: Promise<JoseModule> | null = null

function loadJose() {
  joseModulePromise ||= import('jose')
  return joseModulePromise
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

export type OidcClient = ConsoleOidcClient

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
  refreshExpiresIn: number | null
  expiresIn: number
  tokenType: 'Bearer'
}

export interface ServiceAccessTokenInput {
  event: H3Event
  audience: string
  scope: string
  deploymentCodeOverride?: string | null
  sourceBinding?: 'trusted-gateway' | 'service-client-policy'
  serviceClient: {
    clientId: string
    clientCode: string
    clientName: string
    clientType: string
    appCode: string | null
    credentialId: number
    policyBinding?: {
      tenantCode: string
      deploymentCode: string
    } | null
  }
}

type ServiceTokenTimingStage = 'identity' | 'policy_digest' | 'signing' | 'audit'
const serviceTokenTimings = new WeakMap<H3Event, Partial<Record<ServiceTokenTimingStage, number>>>()

export async function measureServiceTokenStage<T>(event: H3Event, stage: ServiceTokenTimingStage, action: () => Promise<T>) {
  if (process.env.HZY_CONSOLE_TOKEN_TIMING_ENABLED !== 'true') return await action()
  const started = performance.now()
  try {
    return await action()
  } finally {
    const timings = serviceTokenTimings.get(event) || {}
    timings[stage] = Math.round((performance.now() - started) * 100) / 100
    serviceTokenTimings.set(event, timings)
  }
}

export function logServiceTokenTimings(event: H3Event, path: 'gateway' | 'credential') {
  if (process.env.HZY_CONSOLE_TOKEN_TIMING_ENABLED !== 'true') return
  const timings = serviceTokenTimings.get(event)
  serviceTokenTimings.delete(event)
  if (!timings) return
  console.info(JSON.stringify({ event: 'console-service-token-stages', path, durationsMs: timings }))
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

export function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

export function hashOpaqueValue(value: string) {
  return `sha256_${createHash('sha256').update(value).digest('hex')}`
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
  const facade = resolveLocalConsoleFacade(event)
  if (facade) return facade.issuer
  const trustedGateway = resolveTrustedTenantGatewayContext(event)
  if (trustedGateway?.forwardedHost) {
    const localIssuer = localGatewayIssuer({
      enabled: process.env.HZY_LOCAL_TEST_GATEWAY_ENABLED === 'true',
      nodeEnv: process.env.NODE_ENV || '',
      profile: process.env.HZY_DEPLOYMENT_PROFILE || '',
      environment: trustedGateway.environment,
      configuredIssuer: process.env.CONSOLE_OIDC_ISSUER || '',
      forwardedHost: trustedGateway.forwardedHost,
      forwardedProto: String(getHeader(event, 'x-forwarded-proto') || ''),
      forwardedPrefix: String(getHeader(event, 'x-forwarded-prefix') || '')
    })
    if (localIssuer) return localIssuer
    const tenantIssuer = normalizePublicUrl(`https://${trustedGateway.forwardedHost}`)
    if (tenantIssuer) return tenantIssuer
  }

  const config = useRuntimeConfig(event)
  const configured = stringValue(
    runtimeEnvValue(event, 'CONSOLE_OIDC_ISSUER')
    || config.auth?.oidcIssuer
    || process.env.CONSOLE_OIDC_ISSUER
  )
  if (configured) return configured.replace(/\/$/, '')

  const publicServiceUrl = stringValue(config.public?.serviceUrl)
  if (publicServiceUrl) return publicServiceUrl.replace(/\/$/, '')

  return resolveCurrentAppHomeUrl(event).replace(/\/$/, '')
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

export async function ensureCurrentSigningKey(event: H3Event) {
  const jwks = await getPublishedJwks(event)
  const current = jwks.keys[0]
  if (!current) {
    throw createError({ statusCode: 503, message: 'Tenant Runtime OIDC signing key is unavailable.' })
  }
  return {
    kid: stringValue(current.kid),
    alg: stringValue(current.alg) || 'EdDSA'
  }
}

export async function getPublishedJwks(event: H3Event) {
  const startedAt = Date.now()
  try {
    const response = await getConsoleOidcPublishedJwks(event)
    return { keys: response.data.keys as JWK[] }
  } catch (error) {
    logAuthDependencyFailure(event, 'runtime-jwks', error, Date.now() - startedAt)
    throw error
  }
}

export async function findOidcClient(event: H3Event, clientId: string) {
  try {
    return (await resolveConsoleOidcClient(event, { clientId })).data
  } catch (error: unknown) {
    const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0)
    if (statusCode === 404) return null
    throw error
  }
}

export async function requireOidcClient(event: H3Event, clientId: unknown) {
  const normalized = stringValue(clientId)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'invalid_client: client_id is required' })
  }

  const client = await findOidcClient(event, normalized)
  if (!client) {
    throw createError({ statusCode: 400, message: `invalid_client: ${normalized}` })
  }

  if (client.authMode && !['oidc', 'mixed'].includes(client.authMode)) {
    throw createError({ statusCode: 400, message: `invalid_client: client auth_mode is ${client.authMode}` })
  }

  return client
}

export async function assertRedirectUri(event: H3Event, client: OidcClient, redirectUri: unknown, uriType: 'redirect' | 'post_logout' = 'redirect') {
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

function runtimeSessionContext(row: ConsoleRuntimeSession): ConsoleSessionContext {
  return {
    sessionPk: row.sessionPk,
    sessionId: '',
    storedSessionId: row.storedSessionId,
    uid: row.uid,
    identityId: row.identityId,
    authProvider: row.authProvider,
    issuedAt: row.issuedAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    user: {
      uid: row.uid,
      username: row.user.username,
      displayName: row.user.displayName,
      realName: row.user.realName || row.user.displayName || row.user.username || row.uid,
      nickname: row.user.nickname,
      email: row.user.email,
      mobile: row.user.mobile,
      mobileTail4: row.user.mobileTail4,
      avatar: row.user.avatarUrl,
      avatarUrl: row.user.avatarUrl,
      primaryDeptCode: row.user.primaryDeptCode,
      primaryDeptName: row.user.primaryDeptName,
      deptCode: row.user.primaryDeptCode,
      deptName: row.user.primaryDeptName,
      positionTitle: row.user.positionTitle,
      userType: row.user.userType
    },
    identity: row.identity
  }
}

export async function consumeAuthorizationCode(input: {
  event: H3Event
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

  const response = await consumeConsoleOidcAuthorizationCode(input.event, {
    codeHash: hashOpaqueValue(code),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    verifierChallenge: sha256Base64Url(codeVerifier)
  })
  return {
    client: response.data.client,
    session: runtimeSessionContext(response.data.session),
    scope: response.data.scope,
    nonce: response.data.nonce
  }
}

export async function consumeRefreshToken(event: H3Event, token: string, clientId: string) {
  const normalizedToken = stringValue(token)
  if (!normalizedToken) {
    throw createError({ statusCode: 400, message: 'invalid_grant: refresh_token is required' })
  }
  const response = await consumeConsoleOidcRefreshToken(event, {
    tokenHash: hashOpaqueValue(normalizedToken),
    clientId
  })
  return {
    client: response.data.client,
    session: runtimeSessionContext(response.data.session),
    tokenFamily: response.data.tokenFamily
  }
}

export async function loadOidcPolicyDigest(event: H3Event) {
  const localFacade = resolveLocalConsoleFacade(event)
  const policyRequired = localFacade || verifiedPolicyStoreEnabled(event)
  try {
    const config = loadPlatformRuntimeConfig(event)
    const bundle = await readCachedBundle(config.bundleCacheDir, resolvePlatformRuntimeCacheScope(config, event), event)
    if (policyRequired && !bundle?.bundleVersion) {
      throw createError({ statusCode: 503, message: 'Local Console policy is unavailable' })
    }
    return {
      tenantCode: bundle?.tenantCode || config.tenantCode,
      deploymentCode: bundle?.deploymentCode || config.deploymentCode,
      policyVersion: bundle?.bundleVersion || null,
      caps: bundle?.bundleHash || null
    }
  } catch (error) {
    if (policyRequired) {
      const failure = error as { statusCode?: number, data?: { code?: string } }
      const code = failure.data?.code
      console.warn('Console policy digest unavailable', {
        status: failure.statusCode || 503,
        code: typeof code === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(code) ? code : 'policy_read_failed'
      })
      // Explicit verified mode must fail closed even outside the local facade.
      throw createError({ statusCode: 503, message: 'Console policy is unavailable', data: { code: localFacade ? 'local_console_policy_unavailable' : 'verified_console_policy_unavailable' } })
    }
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
  const issuer = getOidcIssuer(input.event)
  const policy = await loadOidcPolicyDigest(input.event)
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

  return (await signConsoleOidcToken(input.event, {
    claims,
    ttlSeconds: input.expiresIn
  })).data.token
}

async function signServiceAccessJwt(input: ServiceAccessTokenInput & { expiresIn: number }) {
  const issuer = getOidcIssuer(input.event)
  const policyDigest = await measureServiceTokenStage(input.event, 'policy_digest',
    () => loadOidcPolicyDigest(input.event))
  const trustedGateway = resolveTrustedTenantGatewayContext(input.event)
  const credentialBinding = input.serviceClient.policyBinding
  if (trustedGateway && credentialBinding && (
    trustedGateway.tenant !== credentialBinding.tenantCode
    || trustedGateway.deployment !== credentialBinding.deploymentCode
  )) {
    throw createError({
      statusCode: 403,
      message: 'Trusted service-token source binding conflicts with the credential grant.'
    })
  }
  const trustedSource = input.sourceBinding === 'service-client-policy' && credentialBinding
    ? {
        tenantCode: credentialBinding.tenantCode,
        deploymentCode: credentialBinding.deploymentCode,
        appCode: String(input.serviceClient.appCode || '').trim()
      }
    : trustedGateway
      ? {
          tenantCode: trustedGateway.tenant,
          deploymentCode: trustedGateway.deployment,
          appCode: trustedGateway.appCode
        }
      : credentialBinding
        ? {
            tenantCode: credentialBinding.tenantCode,
            deploymentCode: credentialBinding.deploymentCode,
            appCode: String(input.serviceClient.appCode || '').trim()
          }
        : null
  const deploymentCodeOverride = stringValue(input.deploymentCodeOverride)
  let policy
  try {
    policy = input.sourceBinding === 'service-client-policy'
      ? bindServiceAccessTokenPolicyToServiceClient({
          policy: policyDigest,
          serviceClientAppCode: input.serviceClient.appCode,
          serviceClientCode: input.serviceClient.clientCode,
          trustedSource
        })
      : bindServiceAccessTokenPolicyToTrustedSource({
          policy: policyDigest,
          serviceClientAppCode: input.serviceClient.appCode,
          trustedSource
        })
  } catch {
    throw createError({
      statusCode: 403,
      message: 'Trusted service-token source binding is invalid.'
    })
  }

  if (deploymentCodeOverride) {
    const trustedRuntimeCode = stringValue(getHeader(input.event, 'x-hzy-data-runtime-code'))
    if (!trustedGateway || !trustedRuntimeCode || deploymentCodeOverride !== trustedRuntimeCode) {
      throw createError({
        statusCode: 403,
        message: 'Trusted data-runtime deployment binding is invalid.'
      })
    }
    policy = {
      ...policy,
      deploymentCode: deploymentCodeOverride
    }
  }

  const claims = buildServiceAccessTokenClaims(input, {
    issuer,
    tenantCode: policy.tenantCode,
    deploymentCode: policy.deploymentCode,
    policyVersion: policy.policyVersion,
    caps: policy.caps
  })
  return await measureServiceTokenStage(input.event, 'signing', async () => (await signConsoleOidcToken(input.event, {
    claims,
    ttlSeconds: input.expiresIn
  })).data.token)
}

export async function issueTokenSet(input: TokenIssueInput): Promise<TokenSet> {
  const expiresIn = getOidcTtl(input.event, 'accessTokenTtlSeconds')
  const [accessToken, idToken] = await Promise.all([
    signJwt({ ...input, tokenUse: 'access', expiresIn }),
    signJwt({ ...input, tokenUse: 'id', expiresIn })
  ])

  let refreshToken: string | null = null
  const refreshExpiresIn = input.issueRefreshToken
    ? clampRefreshTokenTtlSeconds(
        getOidcTtl(input.event, 'refreshTokenTtlSeconds'),
        input.session.expiresAt
      )
    : 0
  if (refreshExpiresIn > 0) {
    refreshToken = createRefreshToken()
    const tokenHash = hashOpaqueValue(refreshToken)
    await issueConsoleOidcRefreshToken(input.event, {
      tokenHash,
      tokenFamily: input.refreshTokenFamily || createTokenFamily(),
      clientId: input.client.clientId,
      sessionIdHash: input.session.storedSessionId,
      ttlSeconds: refreshExpiresIn
    }, `console:oidc-refresh:${tokenHash.slice(-32)}`)
  }

  return {
    accessToken,
    idToken,
    refreshToken,
    refreshExpiresIn: refreshToken ? refreshExpiresIn : null,
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

export async function verifyActiveServiceAccessToken(
  event: H3Event,
  token: string,
  options: { audience?: string } = {}
) {
  const jwks = await getPublishedJwks(event)
  let payload: JWTPayload
  try {
    const { decodeProtectedHeader, importJWK, jwtVerify } = await loadJose()
    const header = decodeProtectedHeader(token)
    const kid = stringValue(header.kid)
    const algorithm = stringValue(header.alg)
    const jwk = kid ? jwks.keys.find(candidate => stringValue(candidate.kid) === kid) : null
    if (!jwk || !algorithm || (stringValue(jwk.alg) && stringValue(jwk.alg) !== algorithm)) {
      throw new Error('signing key not found')
    }
    const key = await importJWK(jwk, algorithm)
    payload = (await jwtVerify(token, key, {
      issuer: getOidcIssuer(event),
      ...(options.audience ? { audience: options.audience } : {})
    })).payload
  } catch {
    throw createError({ statusCode: 401, message: 'invalid_token: signature, issuer, audience, or expiry rejected' })
  }
  if (payload.token_use !== 'service') {
    throw createError({ statusCode: 401, message: 'invalid_token: service token required' })
  }
  const clientId = stringValue(payload.client_id)
  const credentialId = Number((payload.hzy as Record<string, unknown> | undefined)?.credentialId)
  const scope = stringValue(payload.scope)
  if (!clientId || !Number.isSafeInteger(credentialId) || credentialId <= 0 || !scope) {
    throw createError({ statusCode: 401, message: 'invalid_token: service credential identity missing' })
  }
  const state = await verifyConsoleOidcServiceTokenState(event, {
    clientId,
    credentialId,
    scope
  })
  if (!state.data.active) {
    throw createError({ statusCode: 401, message: `invalid_token: ${state.data.reason || 'service credential inactive'}` })
  }
  return payload
}

export async function verifyAccessToken(event: H3Event, token: string) {
  const jwks = await getPublishedJwks(event)
  const keySet = new Map<string, JWK>(jwks.keys.map(key => [stringValue(key.kid), key]))
  const header = JSON.parse(Buffer.from(token.split('.')[0] || '', 'base64url').toString('utf8')) as { kid?: string, alg?: string }
  const jwk = header.kid ? keySet.get(header.kid) : null
  if (!jwk) {
    throw createError({ statusCode: 401, message: 'invalid_token: signing key not found' })
  }

  const { importJWK, jwtVerify } = await loadJose()
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

  const sessionStartedAt = Date.now()
  try {
    await resolveConsoleAuthSession(event, {
      sessionIdHash: sid,
      touch: false
    })
  } catch (error) {
    logAuthDependencyFailure(event, 'runtime-session', error, Date.now() - sessionStartedAt)
    const failure = error as { statusCode?: number, status?: number, response?: { status?: number } }
    const status = Number(failure?.response?.status || failure?.statusCode || failure?.status || 0)
    if (status === 401) {
      throw createError({ statusCode: 401, message: 'invalid_token: session revoked or expired' })
    }
    throw createError({ statusCode: 503, message: 'Console session verification is unavailable',
      data: { code: 'console_session_verification_unavailable' } })
  }

  return payload
}

export async function revokeRefreshToken(event: H3Event, token: string) {
  const normalized = stringValue(token)
  if (!normalized) return false
  const tokenHash = hashOpaqueValue(normalized)
  const response = await revokeConsoleOidcRefreshTokens(
    event,
    { tokenHash },
    `oidc-refresh-revoke:${tokenHash}`
  )
  return response.data.revoked
}

export async function revokeAccessTokenSession(event: H3Event, token: string) {
  const payload = await verifyAccessToken(event, token)
  const sid = stringValue(payload.sid)
  if (!sid) return false

  const response = await revokeConsoleAuthSession(
    event,
    { sessionIdHash: sid },
    `oidc-access-session-revoke:${sid}`
  )
  return response.data.revoked
}

export async function revokeRefreshTokenFamily(event: H3Event, tokenFamily: string) {
  const normalized = stringValue(tokenFamily)
  if (!normalized) return false
  const response = await revokeConsoleOidcRefreshTokens(
    event,
    { tokenFamily: normalized },
    `oidc-refresh-family-revoke:${normalized}`
  )
  return response.data.revoked
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
  await appendConsoleOidcTokenEvent(
    event,
    {
      ...input,
      ipAddress: stringValue(getHeader(event, 'x-forwarded-for')).split(',')[0]
        || event.node.req.socket.remoteAddress
        || null,
      userAgent: stringValue(getHeader(event, 'user-agent')).slice(0, 500) || null
    },
    `oidc-token-event:${randomBytes(16).toString('hex')}`
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
