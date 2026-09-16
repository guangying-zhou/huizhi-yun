import { createError, type H3Event } from 'h3'
import {
  maybeCallTenantRuntime,
  type TenantRuntimeCallOptions,
  type TenantRuntimeMethod
} from './tenantRuntimeClient'

export interface ConsoleTenantProfile {
  tenantCode: string
  orgName: string
  orgShortName: string | null
  displayName: string | null
  legalName: string | null
  unifiedSocialCreditCode: string | null
  logoPath: string | null
  websiteUrl: string | null
  industryCode: string | null
  countryCode: string
  timezone: string
  locale: string
  currencyCode: string
  contactName: string | null
  contactEmail: string | null
  contactMobile: string | null
  addressText: string | null
  status: string
  revision: number
  updatedAt: string
}

export type ConsoleTenantProfileUpdate = Omit<
  ConsoleTenantProfile,
  'tenantCode' | 'status' | 'revision' | 'updatedAt'
> & {
  expectedRevision: number
}

export interface ConsoleTenantRuntimeEnvelope<T> {
  code: number
  data: T
  message?: string
}

type ConsoleRuntimeCallOptions = {
  scope: `console:${string}`
  idempotencyKey?: TenantRuntimeCallOptions['idempotencyKey']
  requireStaticRuntimeToken?: TenantRuntimeCallOptions['requireStaticRuntimeToken']
  serviceTokenSourceBinding?: TenantRuntimeCallOptions['serviceTokenSourceBinding']
  serviceCommandActor?: TenantRuntimeCallOptions['serviceCommandActor']
  timeoutMs?: TenantRuntimeCallOptions['timeoutMs']
  method?: TenantRuntimeMethod
  query?: Record<string, unknown>
  body?: unknown
}

export async function callConsoleTenantRuntime<T>(
  event: H3Event,
  path: `/v1/console/${string}`,
  options: ConsoleRuntimeCallOptions
): Promise<T> {
  const callOptions: TenantRuntimeCallOptions = {
    appCode: 'console',
    scope: options.scope,
    idempotencyKey: options.idempotencyKey,
    requireStaticRuntimeToken: options.requireStaticRuntimeToken,
    serviceTokenSourceBinding: options.serviceTokenSourceBinding,
    serviceCommandActor: options.serviceCommandActor,
    timeoutMs: options.timeoutMs,
    method: options.method,
    query: options.query,
    body: options.body
  }
  const runtime = await maybeCallTenantRuntime<T>(event, path, callOptions)
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Console tenant-runtime is required for tenant data access.'
    })
  }
  return runtime.data
}

export async function getConsoleTenantProfile(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<ConsoleTenantProfile>>(
    event,
    '/v1/console/profile',
    {
      scope: 'console:org-profile:view',
      method: 'GET'
    }
  )
}

export async function updateConsoleTenantProfile(
  event: H3Event,
  body: ConsoleTenantProfileUpdate
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<ConsoleTenantProfile> & { replayed: boolean }>(
    event,
    '/v1/console/profile',
    {
      scope: 'console:org-profile:edit',
      method: 'PUT',
      body
    }
  )
}

export async function getConsoleDirectoryMeta(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/meta',
    { scope: 'console:directory-user:view', method: 'GET' }
  )
}

export async function previewConsoleDingTalkDepartmentMappings(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/hr-sources/dingtalk/department-mappings',
    { scope: 'console:hr-source-sync:view', method: 'GET', serviceTokenSourceBinding: 'service-client-policy' }
  )
}

export async function applyConsoleDingTalkDepartmentMappings(
  event: H3Event,
  body: Record<string, unknown>,
  actorUid: string,
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/hr-sources/dingtalk/department-mappings',
    {
      scope: 'console:hr-source-sync:admin',
      method: 'POST',
      body,
      idempotencyKey,
      serviceTokenSourceBinding: 'service-client-policy',
      serviceCommandActor: { uid: actorUid }
    }
  )
}

export async function getConsoleDingTalkDepartmentChanges(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/hr-sources/dingtalk/department-changes',
    { scope: 'console:hr-source-sync:view', method: 'GET', serviceTokenSourceBinding: 'service-client-policy' }
  )
}

export async function applyConsoleDingTalkDepartmentChanges(
  event: H3Event,
  body: Record<string, unknown>,
  actorUid: string,
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/hr-sources/dingtalk/department-changes',
    {
      scope: 'console:hr-source-sync:admin',
      method: 'POST',
      body,
      idempotencyKey,
      serviceTokenSourceBinding: 'service-client-policy',
      serviceCommandActor: { uid: actorUid }
    }
  )
}

export async function getConsoleDirectoryProvisioning(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/provisioning',
    { scope: 'console:directory-connector:view', method: 'GET' }
  )
}

export async function redeemConsoleDirectoryConnectorEnrollment(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    connectorId: string
    tenantCode: string
    deploymentCode: string
    transport: string
  }>>(
    event,
    '/v1/console/directory-connectors/enroll',
    { scope: 'console:directory-connector:enroll', method: 'POST', body }
  )
}

export async function getConsoleConnectorRuntimeMetadata(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    connector: null | Record<string, unknown>
  }>>(
    event,
    '/v1/console/connector-runtime',
    { scope: 'console:connector-runtime:view', method: 'GET' }
  )
}

export async function issueConsoleConnectorRuntimeEnrollment(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    enrollmentId: string
    enrollmentCode: string
    enrollmentCodeLast4: string
    expiresAt: string
  }>>(
    event,
    '/v1/console/connector-runtime/enrollments',
    { scope: 'console:connector-runtime:admin', method: 'POST', body: {} }
  )
}

export async function redeemConsoleConnectorRuntimeEnrollment(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/connector-runtime/enroll',
    { scope: 'console:connector-runtime:enroll', method: 'POST', body }
  )
}

export async function recordConsoleConnectorRuntimeHeartbeat(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/connector-runtime/heartbeat',
    { scope: 'console:connector-runtime:heartbeat', method: 'POST', body }
  )
}

export async function revokeConsoleConnectorRuntime(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/connector-runtime/revoke',
    { scope: 'console:connector-runtime:admin', method: 'POST', body: {} }
  )
}

export async function listConsoleIntegrations(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ items: Record<string, unknown>[] }>>(
    event,
    '/v1/console/integrations',
    { scope: 'console:integration:view', method: 'GET', query }
  )
}

export async function getConsoleIntegration(event: H3Event, integrationCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/integrations/${encodeURIComponent(integrationCode)}` as `/v1/console/${string}`,
    { scope: 'console:integration:view', method: 'GET' }
  )
}

export async function createConsoleIntegration(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/integrations',
    { scope: 'console:integration:edit', method: 'POST', body }
  )
}

export async function updateConsoleIntegration(
  event: H3Event,
  integrationCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/integrations/${encodeURIComponent(integrationCode)}` as `/v1/console/${string}`,
    { scope: 'console:integration:edit', method: 'PATCH', body }
  )
}

export async function rotateConsoleIntegrationCredential(
  event: H3Event,
  integrationCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/integrations/${encodeURIComponent(integrationCode)}/rotate` as `/v1/console/${string}`,
    { scope: 'console:integration:rotate', method: 'POST', body }
  )
}

export async function checkConsoleIntegration(event: H3Event, integrationCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/integrations/${encodeURIComponent(integrationCode)}/check` as `/v1/console/${string}`,
    { scope: 'console:integration:test', method: 'POST', body: {} }
  )
}

export async function getConsoleOSSAvatar(
  event: H3Event,
  input: {
    integrationCode?: string
    objectPath: string
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    contentBase64: string
    contentType: string
    etag?: string
  }>>(
    event,
    '/v1/console/oss/avatars',
    {
      scope: 'console:avatar-object:read',
      method: 'GET',
      query: {
        integrationCode: input.integrationCode || 'oss.default',
        objectPath: input.objectPath
      }
    }
  )
}

export async function putConsoleOSSAvatar(
  event: H3Event,
  input: {
    integrationCode?: string
    objectPath: string
    contentBase64: string
    contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    objectPath: string
    etag?: string
  }>>(
    event,
    '/v1/console/oss/avatars',
    {
      scope: 'console:avatar-object:write',
      method: 'PUT',
      query: {
        integrationCode: input.integrationCode || 'oss.default'
      },
      body: {
        objectPath: input.objectPath,
        contentBase64: input.contentBase64,
        contentType: input.contentType
      }
    }
  )
}

export async function issueConsoleExternalLoginTransaction(
  event: H3Event,
  body: {
    provider: 'wecom' | 'dingtalk'
    integrationCode?: string | null
    stateSha256: string
    browserBindingSha256: string
    targetApp: string
    redirect: string
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    transactionId: string
    expiresAt: string
  }>>(
    event,
    '/v1/console/auth/external-login-transactions',
    {
      scope: 'console:auth-external-login:write',
      method: 'POST',
      body
    }
  )
}

export async function consumeConsoleExternalLoginTransaction(
  event: H3Event,
  body: {
    provider: 'wecom' | 'dingtalk'
    stateSha256: string
    browserBindingSha256: string
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    targetApp: string
    integrationCode: string | null
    redirect: string
  }>>(
    event,
    '/v1/console/auth/external-login-transactions/consume',
    {
      scope: 'console:auth-external-login:write',
      method: 'POST',
      body
    }
  )
}

export interface ConsoleRuntimeSession {
  sessionPk: number
  storedSessionId: string
  uid: string
  identityId: number | null
  authProvider: string
  issuedAt: string
  lastSeenAt: string | null
  expiresAt: string
  user: {
    id: number
    uid: string
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
  identity: {
    providerCode: string | null
    providerSubject: string | null
  }
}

export async function issueConsoleAuthSession(
  event: H3Event,
  body: {
    sessionIdHash: string
    uid: string
    identityId?: number | null
    authProvider: string
    ipAddress?: string | null
    userAgent?: string | null
    deviceSummary?: string | null
    ttlSeconds: number
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    storedSessionId: string
    expiresAt: string
    ttlSeconds: number
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/sessions',
    {
      scope: 'console:auth-session:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function resolveConsoleAuthSession(
  event: H3Event,
  body: { sessionIdHash: string, touch: boolean }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<ConsoleRuntimeSession>>(
    event,
    '/v1/console/auth/sessions/resolve',
    {
      scope: 'console:auth-session:read',
      method: 'POST',
      body
    }
  )
}

export async function revokeConsoleAuthSession(
  event: H3Event,
  body: { sessionIdHash: string },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    revoked: boolean
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/sessions/revoke',
    {
      scope: 'console:auth-session:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function resolveOrBindConsoleAuthIdentity(
  event: H3Event,
  body: {
    providerCode: string
    providerSubject: string
    providerUsername?: string | null
    email?: string | null
    mobileTail4?: string | null
    uidCandidates?: Array<string | null | undefined>
    profile?: Record<string, unknown> | null
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    identityId: number
    uid: string
    providerCode: string
    providerSubject: string
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/identities/resolve-or-bind',
    {
      scope: 'console:auth-identity:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export interface ConsoleAuthClientMaterialization {
  appCode: string
  clientId: string
  clientName: string
  authMode: string
  homeUrl: string | null
  callbackUrl: string | null
  logoutUrl: string | null
  icon: string | null
  description: string | null
  sourceHash: string
  status: string
}

export async function materializeConsoleAuthClients(
  event: H3Event,
  body: {
    mode: 'upsert' | 'append' | 'local'
    source: 'bundle' | 'bundle_test' | 'local'
    applications: ConsoleAuthClientMaterialization[]
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>> & { replayed: boolean }>(
    event,
    '/v1/console/auth/clients/materialize',
    {
      scope: 'console:auth-client:sync',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function getConsoleAuthRuntimeHealth(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    signingKid: string | null
    activeClients: number
    activeSessions: number
    lastAuthError: string | null
    lastAuthErrorAt: string | null
  }>>(
    event,
    '/v1/console/auth/health-summary',
    {
      scope: 'console:auth-health:view',
      method: 'GET'
    }
  )
}

export interface ConsoleOidcClient {
  id: number
  clientId: string
  clientName: string
  appCode: string | null
  clientType: string
  authMode: string
  homeUrl: string | null
  logoutUrl: string | null
  status: string
  validatedRedirectUri?: string
}

export async function resolveConsoleOidcClient(
  event: H3Event,
  body: {
    clientId: string
    redirectUri?: string
    uriType?: 'redirect' | 'post_logout'
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<ConsoleOidcClient>>(
    event,
    '/v1/console/auth/oidc/clients/resolve',
    {
      scope: 'console:auth-oidc:read',
      method: 'POST',
      body
    }
  )
}

export async function createConsoleOidcAuthorizationCode(
  event: H3Event,
  body: {
    codeHash: string
    clientId: string
    sessionIdHash: string
    redirectUri: string
    scope: string
    stateHash?: string | null
    nonceHash?: string | null
    nonce?: string | null
    codeChallenge: string
    codeChallengeMethod: 'S256'
    ttlSeconds: number
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    created: boolean
    expiresAt: string
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/oidc/authorization-codes',
    {
      scope: 'console:auth-oidc:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function consumeConsoleOidcAuthorizationCode(
  event: H3Event,
  body: {
    codeHash: string
    clientId: string
    redirectUri: string
    verifierChallenge: string
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    client: ConsoleOidcClient
    session: ConsoleRuntimeSession
    scope: string
    nonce: string | null
  }>>(
    event,
    '/v1/console/auth/oidc/authorization-codes/consume',
    {
      scope: 'console:auth-oidc:write',
      method: 'POST',
      body
    }
  )
}

export async function issueConsoleOidcRefreshToken(
  event: H3Event,
  body: {
    tokenHash: string
    tokenFamily: string
    clientId: string
    sessionIdHash: string
    ttlSeconds: number
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    created: boolean
    expiresAt: string
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/oidc/refresh-tokens',
    {
      scope: 'console:auth-oidc:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function consumeConsoleOidcRefreshToken(
  event: H3Event,
  body: {
    tokenHash: string
    clientId: string
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    client: ConsoleOidcClient
    session: ConsoleRuntimeSession
    tokenFamily: string
  }>>(
    event,
    '/v1/console/auth/oidc/refresh-tokens/consume',
    {
      scope: 'console:auth-oidc:write',
      method: 'POST',
      body
    }
  )
}

export async function revokeConsoleOidcRefreshTokens(
  event: H3Event,
  body: {
    tokenHash?: string
    tokenFamily?: string
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    revoked: boolean
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/oidc/refresh-tokens/revoke',
    {
      scope: 'console:auth-oidc:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function appendConsoleOidcTokenEvent(
  event: H3Event,
  body: {
    eventType: string
    clientId?: string | null
    uid?: string | null
    sessionHash?: string | null
    tokenHash?: string | null
    result?: 'success' | 'failed'
    failureReason?: string | null
    ipAddress?: string | null
    userAgent?: string | null
  },
  idempotencyKey: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    appended: boolean
  }> & { replayed: boolean }>(
    event,
    '/v1/console/auth/oidc/token-events',
    {
      scope: 'console:auth-oidc:write',
      method: 'POST',
      body,
      idempotencyKey
    }
  )
}

export async function getConsoleOidcPublishedJwks(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    keys: Array<Record<string, unknown>>
  }>>(
    event,
    '/v1/console/auth/oidc/jwks',
    {
      scope: 'console:auth-oidc:read',
      serviceTokenSourceBinding: 'service-client-policy',
      method: 'GET'
    }
  )
}

export async function signConsoleOidcToken(
  event: H3Event,
  body: {
    claims: Record<string, unknown>
    ttlSeconds: number
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    token: string
    kid: string
    alg: string
    expiresAt: string
  }>>(
    event,
    '/v1/console/auth/oidc/sign',
    {
      scope: 'console:auth-oidc:sign',
      method: 'POST',
      body
    }
  )
}

export async function verifyConsoleOidcServiceTokenState(
  event: H3Event,
  body: {
    clientId: string
    credentialId: number
    scope: string
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    active: boolean
    reason?: string
  }>>(
    event,
    '/v1/console/auth/oidc/service-token-state',
    {
      scope: 'console:auth-oidc:read',
      serviceTokenSourceBinding: 'service-client-policy',
      method: 'POST',
      body
    }
  )
}

export async function issueConsoleRuntimeServiceToken(
  event: H3Event,
  body: {
    audience: string
    scope: string
    issuedScope?: string
    issuer: string
    ttlSeconds: number
    sourceBinding?: 'trusted-gateway' | 'service-client-policy'
    deploymentCodeOverride?: string | null
    policyVersion?: string | null
    caps?: string | null
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    accessToken: string
    tokenType: 'Bearer'
    expiresIn: number
    scope: string
  }>>(
    event,
    '/v1/console/auth/service-tokens/issue',
    {
      scope: 'console:service-token:issue',
      method: 'POST',
      body,
      requireStaticRuntimeToken: true
    }
  )
}

export interface ConsoleServiceClientTokenSubject {
  serviceClientId: number
  credentialId: number
  clientId: string
  clientCode: string
  clientName: string
  clientType: string
  appCode: string | null
  scope: string
  policyBinding?: {
    tenantCode: string
    deploymentCode: string
  } | null
}

async function consumeConsoleServiceClientIdentity(
  event: H3Event,
  path:
    | '/v1/console/auth/service-clients/consume'
    | '/v1/console/auth/runtime-app-identities/consume'
    | '/v1/console/auth/bootstrap-access-keys/consume',
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<ConsoleServiceClientTokenSubject>>(
    event,
    path,
    {
      scope: 'console:service-client:consume',
      method: 'POST',
      body,
      requireStaticRuntimeToken: true
    }
  )
}

export async function consumeConsoleServiceClientCredential(
  event: H3Event,
  body: {
    clientId: string
    clientSecret: string
    audience: string
    scope?: string
  }
) {
  return await consumeConsoleServiceClientIdentity(
    event,
    '/v1/console/auth/service-clients/consume',
    body
  )
}

export async function consumeConsoleRuntimeAppIdentity(
  event: H3Event,
  body: {
    appCode: string
    clientId?: string
    audience: string
    scope?: string
  }
) {
  return await consumeConsoleServiceClientIdentity(
    event,
    '/v1/console/auth/runtime-app-identities/consume',
    body
  )
}

export async function consumeConsoleBootstrapAccessKey(
  event: H3Event,
  body: {
    appCode: string
    deploymentCode: string
    accessKey: string
    audience: string
    scope?: string
  }
) {
  return await consumeConsoleServiceClientIdentity(
    event,
    '/v1/console/auth/bootstrap-access-keys/consume',
    body
  )
}

export async function getConsoleDirectoryPasswordCapability(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/me/password-capability',
    { scope: 'console:directory-connector:view', method: 'GET' }
  )
}

export async function queueConsoleDirectoryPasswordChange(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/me/password',
    { scope: 'console:directory-connector:execute', method: 'POST', body }
  )
}

export async function getConsoleDirectoryConnectorOperation(event: H3Event, operationId: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/operations/${encodeURIComponent(operationId)}` as `/v1/console/${string}`,
    { scope: 'console:directory-connector:view', method: 'GET' }
  )
}

export async function getConsoleDirectoryConnectorOperationForServiceCommand(
  event: H3Event,
  operationId: string,
  serviceCommandBody: Record<string, unknown>,
  actorUid: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/operations/${encodeURIComponent(operationId)}`,
    {
      scope: 'console:directory-connector:view',
      method: 'POST',
      body: serviceCommandBody,
      serviceCommandActor: { uid: actorUid }
    }
  )
}

export async function queueConsoleDirectoryLDAPTest(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/sources/ldap/test',
    { scope: 'console:directory-connector:execute', method: 'POST', body: {} }
  )
}

export async function queueConsoleDirectoryLDAPSync(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/connector-operations/ldap-sync',
    { scope: 'console:directory-connector:execute', method: 'POST', body: {} }
  )
}

export async function queueConsoleDirectoryLDAPUserCreate(
  event: H3Event,
  body: Record<string, unknown>,
  serviceCommand?: { body: Record<string, unknown>, actorUid: string }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/connector-operations/users',
    {
      scope: 'console:directory-connector:execute',
      method: 'POST',
      body: serviceCommand?.body || body,
      serviceCommandActor: serviceCommand ? { uid: serviceCommand.actorUid } : undefined
    }
  )
}

export async function previewConsoleDirectorySubjectMerge(
  event: H3Event,
  legacyUid: string,
  canonicalUid: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/subject-merge:preview?legacyUid=${encodeURIComponent(legacyUid)}&canonicalUid=${encodeURIComponent(canonicalUid)}`,
    { scope: 'console:directory-connector:execute', method: 'GET' }
  )
}

export async function mergeConsoleDirectorySubject(
  event: H3Event,
  legacyUid: string,
  canonicalUid: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/subject-merge',
    { scope: 'console:directory-connector:execute', method: 'POST', body: { legacyUid, canonicalUid } }
  )
}

export async function readConsoleEmploymentLifecycleStatus(event: H3Event, uid: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/employment-lifecycle-status?uid=${encodeURIComponent(uid)}`,
    { scope: 'console:directory-connector:execute', method: 'GET' }
  )
}

export async function reserveConsoleDirectoryIdentity(
  event: H3Event,
  body: Record<string, unknown>,
  serviceCommand?: { body: Record<string, unknown>, actorUid: string }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/identity-reservations',
    {
      scope: 'console:directory-connector:execute',
      method: 'POST',
      body: serviceCommand?.body || body,
      serviceCommandActor: serviceCommand ? { uid: serviceCommand.actorUid } : undefined
    }
  )
}

export async function releaseConsoleDirectoryIdentityReservation(
  event: H3Event,
  reservationId: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/identity-reservations/${encodeURIComponent(reservationId)}`,
    { scope: 'console:directory-connector:execute', method: 'DELETE' }
  )
}

export async function releaseConsoleDirectoryIdentityReservationForServiceCommand(
  event: H3Event,
  serviceCommandBody: Record<string, unknown>,
  actorUid: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/identity-reservations:release',
    {
      scope: 'console:directory-connector:execute',
      method: 'POST',
      body: serviceCommandBody,
      serviceCommandActor: { uid: actorUid }
    }
  )
}

export async function issueConsoleDirectoryActivationCredentialForServiceCommand(
  event: H3Event,
  serviceCommandBody: Record<string, unknown>,
  actorUid: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/activation/issue',
    {
      scope: 'console:directory-connector:execute',
      method: 'POST',
      body: serviceCommandBody,
      serviceCommandActor: { uid: actorUid }
    }
  )
}

export async function suggestConsoleDirectoryIdentity(
  event: H3Event,
  base: string,
  emailDomain: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/identity-reservations:suggest',
    { scope: 'console:directory-connector:execute', method: 'POST', body: { base, emailDomain } }
  )
}

// 激活凭据的查看与兑换由尚未拥有账号的员工触发，因此没有用户身份可用；
// 凭据本身是唯一的授权材料，调用仍受 Console 的 runtime 服务认证保护。
export async function inspectConsoleDirectoryActivationCredential(
  event: H3Event,
  token: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/activation/inspect',
    { scope: 'console:directory-connector:execute', method: 'POST', body: { token } }
  )
}

export async function redeemConsoleDirectoryActivationCredential(
  event: H3Event,
  token: string,
  newPassword: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/activation/redeem',
    { scope: 'console:directory-connector:execute', method: 'POST', body: { token, newPassword } }
  )
}

export async function getConsoleDirectorySources(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/directory/sources',
    { scope: 'console:directory-source:view', method: 'GET' }
  )
}

export async function getConsoleDirectorySource(event: H3Event, providerCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/sources/${encodeURIComponent(providerCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-source:view', method: 'GET' }
  )
}

export async function upsertConsoleDirectorySource(
  event: H3Event,
  providerCode: string | null,
  body: Record<string, unknown>
) {
  const path = providerCode
    ? `/v1/console/directory/sources/${encodeURIComponent(providerCode)}` as `/v1/console/${string}`
    : '/v1/console/directory/sources'
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    path,
    {
      scope: 'console:directory-source:edit',
      method: providerCode ? 'PUT' : 'POST',
      body
    }
  )
}

export async function getConsoleDirectoryUsers(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/users',
    { scope: 'console:directory-user:view', method: 'GET', query }
  )
}

export async function createConsoleDirectoryUser(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ uid: string }> & {
    receiptId: string
    replayed: boolean
  }>(
    event,
    '/v1/console/directory/users',
    { scope: 'console:directory-user:edit', method: 'POST', body }
  )
}

export async function updateConsoleDirectoryUser(
  event: H3Event,
  uid: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ uid: string }> & {
    receiptId: string
    replayed: boolean
  }>(
    event,
    `/v1/console/directory/users/${encodeURIComponent(uid)}` as `/v1/console/${string}`,
    { scope: 'console:directory-user:edit', method: 'PATCH', body }
  )
}

export async function getConsoleDirectoryUser(
  event: H3Event,
  uid: string,
  includeInactive = false
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/users/${encodeURIComponent(uid)}` as `/v1/console/${string}`,
    {
      scope: 'console:directory-user:view',
      method: 'GET',
      query: includeInactive ? { includeInactive: true } : undefined
    }
  )
}

export async function getConsoleDirectoryUsersBatch(event: H3Event, uids: string[]) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/directory/users/batch',
    { scope: 'console:directory-user:view', method: 'POST', body: { uids } }
  )
}

export async function getConsoleDirectoryUserDepartments(event: H3Event, uid?: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/user-departments',
    {
      scope: 'console:directory-user:view',
      method: 'GET',
      query: uid ? { uid } : undefined
    }
  )
}

export async function getConsoleAccessibleDepartments(event: H3Event, uid: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/directory/accessible-departments',
    { scope: 'console:directory-department:view', method: 'GET', query: { uid } }
  )
}

export async function getConsoleDirectoryDepartments(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/departments',
    { scope: 'console:directory-department:view', method: 'GET', query }
  )
}

export async function createConsoleDirectoryDepartment(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ code: string }>>(
    event,
    '/v1/console/directory/departments',
    { scope: 'console:directory-department:edit', method: 'POST', body }
  )
}

export async function updateConsoleDirectoryDepartment(
  event: H3Event,
  deptCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ code: string }>>(
    event,
    `/v1/console/directory/departments/${encodeURIComponent(deptCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:edit', method: 'PATCH', body }
  )
}

export async function deleteConsoleDirectoryDepartment(event: H3Event, deptCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ deleted: boolean }>>(
    event,
    `/v1/console/directory/departments/${encodeURIComponent(deptCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:edit', method: 'DELETE' }
  )
}

export async function getConsoleDirectoryDepartment(event: H3Event, deptCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/departments/${encodeURIComponent(deptCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:view', method: 'GET' }
  )
}

export async function getConsoleDirectoryDepartmentMembers(
  event: H3Event,
  deptCode: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/departments/${encodeURIComponent(deptCode)}/members` as `/v1/console/${string}`,
    { scope: 'console:directory-department:view', method: 'GET', query }
  )
}

export async function getConsoleDirectoryCommittees(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/committees',
    { scope: 'console:directory-department:view', method: 'GET', query }
  )
}

export async function createConsoleDirectoryCommittee(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ code: string }>>(
    event,
    '/v1/console/directory/committees',
    { scope: 'console:directory-department:edit', method: 'POST', body }
  )
}

export async function updateConsoleDirectoryCommittee(
  event: H3Event,
  committeeCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ code: string }>>(
    event,
    `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:edit', method: 'PATCH', body }
  )
}

export async function deleteConsoleDirectoryCommittee(event: H3Event, committeeCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ deleted: boolean }>>(
    event,
    `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:edit', method: 'DELETE' }
  )
}

export async function getConsoleDirectoryCommittee(event: H3Event, committeeCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:view', method: 'GET' }
  )
}

export async function getConsoleDirectoryCommitteeMembers(
  event: H3Event,
  committeeCode: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members` as `/v1/console/${string}`,
    { scope: 'console:directory-department:view', method: 'GET', query }
  )
}

export async function saveConsoleDirectoryCommitteeMembers(
  event: H3Event,
  committeeCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ committeeCode: string, updatedCount: number }>>(
    event,
    `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members` as `/v1/console/${string}`,
    { scope: 'console:directory-department:edit', method: 'POST', body }
  )
}

export async function removeConsoleDirectoryCommitteeMember(
  event: H3Event,
  committeeCode: string,
  uid: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ removed: boolean }>>(
    event,
    `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members/${encodeURIComponent(uid)}` as `/v1/console/${string}`,
    { scope: 'console:directory-department:edit', method: 'DELETE' }
  )
}

export async function getConsoleDirectoryProjects(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/projects',
    { scope: 'console:directory-project:view', method: 'GET', query }
  )
}

export async function createConsoleDirectoryProject(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ projectCode: string }>>(
    event,
    '/v1/console/directory/projects',
    { scope: 'console:directory-project:edit', method: 'POST', body }
  )
}

export async function updateConsoleDirectoryProject(
  event: H3Event,
  projectCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ projectCode: string }>>(
    event,
    `/v1/console/directory/projects/${encodeURIComponent(projectCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-project:edit', method: 'PATCH', body }
  )
}

export async function deleteConsoleDirectoryProject(event: H3Event, projectCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ deleted: boolean }>>(
    event,
    `/v1/console/directory/projects/${encodeURIComponent(projectCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-project:edit', method: 'DELETE' }
  )
}

export async function replaceConsoleDirectoryProjectMembers(
  event: H3Event,
  projectCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ projectCode: string, memberCount: number }>>(
    event,
    `/v1/console/directory/projects/${encodeURIComponent(projectCode)}/members` as `/v1/console/${string}`,
    { scope: 'console:directory-project:edit', method: 'POST', body }
  )
}

export async function getConsoleDirectoryProject(event: H3Event, projectCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/projects/${encodeURIComponent(projectCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-project:view', method: 'GET' }
  )
}

export async function getConsoleDirectoryProjectMembers(
  event: H3Event,
  projectCode: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/projects/${encodeURIComponent(projectCode)}/members` as `/v1/console/${string}`,
    { scope: 'console:directory-project:view', method: 'GET', query }
  )
}

export async function getConsoleDirectoryUserProjects(
  event: H3Event,
  uid: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/users/${encodeURIComponent(uid)}/projects` as `/v1/console/${string}`,
    { scope: 'console:directory-user:view', method: 'GET', query }
  )
}

export async function getConsoleDirectorySubjectExports(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/subjects/export',
    { scope: 'console:directory-sync:export', method: 'GET', query }
  )
}

export async function getConsoleDirectorySubjectMemberships(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/directory/subjects/memberships',
    { scope: 'console:directory-sync:export', method: 'GET', query }
  )
}

export async function getConsoleDirectorySyncJobs(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/directory/sync-jobs',
    { scope: 'console:directory-sync:view', method: 'GET', query }
  )
}

export async function getConsoleDirectorySyncJob(event: H3Event, jobCode: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    `/v1/console/directory/sync-jobs/${encodeURIComponent(jobCode)}` as `/v1/console/${string}`,
    { scope: 'console:directory-sync:view', method: 'GET' }
  )
}

export async function getConsoleDirectorySyncEvents(
  event: H3Event,
  jobCode: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    `/v1/console/directory/sync-jobs/${encodeURIComponent(jobCode)}/events` as `/v1/console/${string}`,
    { scope: 'console:directory-sync:view', method: 'GET', query }
  )
}

export async function startConsoleDirectorySubjectSync(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/sync-jobs',
    { scope: 'console:directory-sync:edit', method: 'POST', body }
  )
}

export async function registerConsoleDingTalkDirectoryProfileJob(
  event: H3Event,
  jobCode: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/directory/sync-jobs/dingtalk-profile',
    {
      scope: 'console:directory-sync:edit',
      method: 'POST',
      body: { jobCode }
    }
  )
}

export async function updateConsoleDirectoryOwnAvatar(
  event: H3Event,
  body: {
    avatarPath: string
    contentType: 'image/png' | 'image/jpeg' | 'image/webp'
    size: number
  }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ avatar: string }> & {
    receiptId: string
    replayed: boolean
  }>(
    event,
    '/v1/console/directory/me/avatar',
    { scope: 'console:directory-profile:edit', method: 'PUT', body }
  )
}

export async function applyConsoleDirectoryLifecycle(
  event: H3Event,
  uid: string,
  kind: 'employment' | 'offboarding',
  body: Record<string, unknown>
) {
  const action = kind === 'employment' ? 'employment' : 'offboarding'
  const scope = kind === 'employment'
    ? 'console:directory-employment:sync'
    : 'console:directory-offboarding:disable'
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    receiptId: string
    receiptStatus: string
    idempotent: boolean
    result: Record<string, unknown>
  }>>(
    event,
    `/v1/console/directory/service/users/${encodeURIComponent(uid)}/${action}` as `/v1/console/${string}`,
    { scope, serviceTokenSourceBinding: 'service-client-policy', method: 'POST', body }
  )
}

export async function applyConsoleDingTalkDirectoryProfileCommand(
  event: H3Event,
  kind: 'batch' | 'failure',
  body: Record<string, unknown>
) {
  const suffix = kind === 'batch' ? 'batches' : 'failures'
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/directory/service/dingtalk-profile-sync-${suffix}` as `/v1/console/${string}`,
    {
      scope: 'console:directory-profiles:sync',
      serviceTokenSourceBinding: 'service-client-policy',
      timeoutMs: 20_000,
      method: 'POST',
      body
    }
  )
}

export async function getConsoleSettingCatalogs(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ items: unknown[] }>>(
    event,
    '/v1/console/settings/catalog',
    {
      scope: 'console:system-setting:view',
      method: 'GET',
      query
    }
  )
}

export async function getConsoleSettingValues(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ items: unknown[] }>>(
    event,
    '/v1/console/settings/values',
    {
      scope: 'console:system-setting:view',
      method: 'GET',
      query
    }
  )
}

export async function updateConsoleSettingValue(
  event: H3Event,
  settingKey: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/settings/values/${encodeURIComponent(settingKey)}` as `/v1/console/${string}`,
    {
      scope: 'console:system-setting:edit',
      method: 'PUT',
      body
    }
  )
}

export async function updateConsoleManagedSettingValue(
  event: H3Event,
  settingKey: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/settings/managed-values/${encodeURIComponent(settingKey)}` as `/v1/console/${string}`,
    {
      scope: 'console:system-setting:manage',
      method: 'PUT',
      body
    }
  )
}

export async function getConsoleBusinessDomains(event: H3Event, query: Record<string, unknown> = {}) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/business-domains',
    { scope: 'console:business-domain:view', method: 'GET', query }
  )
}

export async function createConsoleBusinessDomains(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    '/v1/console/business-domains',
    { scope: 'console:business-domain:edit', method: 'POST', body }
  )
}

export async function updateConsoleBusinessDomain(event: H3Event, code: string, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/business-domains/${encodeURIComponent(code)}` as `/v1/console/${string}`,
    { scope: 'console:business-domain:edit', method: 'PATCH', body }
  )
}

export async function deleteConsoleBusinessDomain(event: H3Event, code: string, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/business-domains/${encodeURIComponent(code)}` as `/v1/console/${string}`,
    { scope: 'console:business-domain:edit', method: 'DELETE', body }
  )
}

export async function getConsoleRegions(event: H3Event, query: Record<string, unknown> = {}) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/regions',
    { scope: 'console:region:view', method: 'GET', query }
  )
}

export async function createConsoleRegion(event: H3Event, body: Record<string, unknown>, fromTemplate = '') {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    '/v1/console/regions',
    {
      scope: 'console:region:edit',
      method: 'POST',
      body,
      query: fromTemplate ? { fromTemplate } : undefined
    }
  )
}

export async function updateConsoleRegion(event: H3Event, code: string, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/regions/${encodeURIComponent(code)}` as `/v1/console/${string}`,
    { scope: 'console:region:edit', method: 'PATCH', body }
  )
}

export async function deleteConsoleRegion(event: H3Event, code: string, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/regions/${encodeURIComponent(code)}` as `/v1/console/${string}`,
    { scope: 'console:region:edit', method: 'DELETE', body }
  )
}

export async function getConsoleRegionDivisions(event: H3Event, code: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]> & { meta: { revision: number } }>(
    event,
    `/v1/console/regions/${encodeURIComponent(code)}/divisions` as `/v1/console/${string}`,
    { scope: 'console:region:view', method: 'GET' }
  )
}

export async function replaceConsoleRegionDivisions(event: H3Event, code: string, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/regions/${encodeURIComponent(code)}/divisions` as `/v1/console/${string}`,
    { scope: 'console:region:edit', method: 'PUT', body }
  )
}

export async function getConsoleWorkCalendars(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    '/v1/console/work-calendars',
    { scope: 'console:work-calendar:view', method: 'GET' }
  )
}

export async function getConsoleWorkCalendarMonths(
  event: H3Event,
  calendarCode: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    `/v1/console/work-calendars/${encodeURIComponent(calendarCode)}/months` as `/v1/console/${string}`,
    { scope: 'console:work-calendar:view', method: 'GET', query }
  )
}

export async function getConsoleWorkCalendarDays(
  event: H3Event,
  calendarCode: string,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown[]>>(
    event,
    `/v1/console/work-calendars/${encodeURIComponent(calendarCode)}/days` as `/v1/console/${string}`,
    { scope: 'console:work-calendar:view', method: 'GET', query }
  )
}

export async function getConsoleWorkCalendarMonth(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/service/work-calendar/month',
    { scope: 'console:work-calendar:view', method: 'GET', query }
  )
}

export async function importConsoleWorkCalendarYear(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    '/v1/console/work-calendars/import-year',
    { scope: 'console:work-calendar:import', method: 'POST', body }
  )
}

export async function updateConsoleWorkCalendarDay(
  event: H3Event,
  calendarCode: string,
  workDate: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/work-calendars/${encodeURIComponent(calendarCode)}/days/${encodeURIComponent(workDate)}` as `/v1/console/${string}`,
    { scope: 'console:work-calendar:edit', method: 'PATCH', body }
  )
}

export async function getConsoleOperationLogs(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/audit/operation-logs',
    { scope: 'console:audit:view', method: 'GET', query }
  )
}

export async function getConsoleLoginLogs(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/audit/login-logs',
    { scope: 'console:audit:view', method: 'GET', query }
  )
}

export async function getConsoleLifecycleAuditMetrics(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/audit/lifecycle-metrics',
    { scope: 'console:audit:view', method: 'GET', query }
  )
}

export async function appendConsoleOperationLog(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<null> & { replayed: boolean }>(
    event,
    '/v1/console/audit/operation-logs',
    { scope: 'console:audit:write', method: 'POST', body }
  )
}

export async function appendConsoleLoginLog(
  event: H3Event,
  body: Record<string, unknown>,
  idempotencyKey?: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<null> & { replayed: boolean }>(
    event,
    '/v1/console/audit/login-logs',
    { scope: 'console:audit:write', method: 'POST', body, idempotencyKey }
  )
}

export async function appendConsoleHumanOperationLog(
  event: H3Event,
  body: Record<string, unknown>,
  idempotencyKey?: string
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<null> & { replayed: boolean }>(
    event,
    '/v1/console/audit/human-operation-logs',
    { scope: 'console:audit:write', method: 'POST', body, idempotencyKey }
  )
}

export async function getConsoleRuntimeClipboard(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown> | null>>(
    event,
    '/v1/console/runtime/clipboard',
    { scope: 'console:runtime-compat:read', method: 'GET' }
  )
}

export async function setConsoleRuntimeClipboard(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<null>>(
    event,
    '/v1/console/runtime/clipboard',
    { scope: 'console:runtime-compat:manage', method: 'PUT', body }
  )
}

export async function writeConsoleRuntimeHeartbeat(event: H3Event, body: Record<string, unknown>) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<null>>(
    event,
    '/v1/console/runtime/presence/heartbeat',
    { scope: 'console:runtime-compat:manage', method: 'POST', body }
  )
}

export async function getConsoleRuntimeOnlineHeartbeats(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    total: number
    items: Array<Record<string, unknown>>
  }>>(
    event,
    '/v1/console/runtime/presence/online',
    { scope: 'console:runtime-compat:read', method: 'GET', query }
  )
}

export interface ConsolePlatformLifecycleOperation {
  operationId: string
  operationCode: 'console.platform.employment-sync.v1' | 'console.platform.offboarding-revoke.v1'
  uid: string
  status: string
  attemptCount: number
  lastErrorCode: string | null
  lastErrorClass: string | null
  createdAt: string
  updatedAt: string
  succeededAt: string | null
}

export interface ConsolePlatformLifecycleAttempt {
  operationId: string
  attemptNo: number
  status: string
  errorCode: string | null
  startedAt: string
  finishedAt: string | null
}

export async function getConsolePlatformLifecycleOperations(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    items: ConsolePlatformLifecycleOperation[]
  }>>(
    event,
    '/v1/console/platform-lifecycle/operations',
    { scope: 'console:platform-lifecycle:view', method: 'GET', query }
  )
}

export async function getConsolePlatformLifecycleAttempts(event: H3Event, operationId: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    items: ConsolePlatformLifecycleAttempt[]
  }>>(
    event,
    `/v1/console/platform-lifecycle/operations/${encodeURIComponent(operationId)}/attempts` as `/v1/console/${string}`,
    { scope: 'console:platform-lifecycle:view', method: 'GET' }
  )
}

export async function getConsolePlatformLifecycleRetrySource(
  event: H3Event,
  query: { uid: string, phase: string }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    operationId: string
    tenantCode: string
    deploymentCode: string
    operationCode: 'console.platform.employment-sync.v1' | 'console.platform.offboarding-revoke.v1'
    requiredCapability: string
    idempotencyKey: string
    commandSchemaVersion: string
    command: Record<string, unknown>
    commandSha256: string
    positionCode: string
    positionName: string
    deptCode: string
  } | null>>(
    event,
    '/v1/console/platform-lifecycle/dead-letter-retry-source',
    { scope: 'console:platform-lifecycle:view', method: 'GET', query }
  )
}

export async function cancelConsolePlatformLifecycleRetry(
  event: H3Event,
  body: { operationId: string, uid: string, phase: string }
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ cancelled: number }>>(
    event,
    '/v1/console/platform-lifecycle/dead-letter-retry-cancel',
    { scope: 'console:platform-lifecycle:execute', method: 'POST', body }
  )
}

export async function getConsoleUserNotifications(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/notifications',
    { scope: 'console:notification:read', method: 'GET', query }
  )
}

export async function getConsoleUserNotificationSummary(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/notifications/summary',
    { scope: 'console:notification:read', method: 'GET' }
  )
}

export async function getConsoleUserNotificationDetailFact(event: H3Event, notificationId: string) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/notifications/${encodeURIComponent(notificationId)}/detail-fact` as `/v1/console/${string}`,
    { scope: 'console:notification:read', method: 'GET' }
  )
}

export async function markAllConsoleUserNotificationsRead(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    '/v1/console/notifications/read-all',
    { scope: 'console:notification:manage', method: 'POST', body }
  )
}

export async function mutateConsoleUserNotification(
  event: H3Event,
  notificationId: string,
  operation: 'read' | 'archive'
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown> & { replayed: boolean }>(
    event,
    `/v1/console/notifications/${encodeURIComponent(notificationId)}/${operation}` as `/v1/console/${string}`,
    { scope: 'console:notification:manage', method: 'POST', body: {} }
  )
}

export async function getConsoleUserNotificationTodos(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    items: Array<Record<string, unknown>>
    nextCursor: string | null
  }>>(
    event,
    '/v1/console/notifications/todos',
    { scope: 'console:notification:read', method: 'GET', query }
  )
}

export async function getConsoleUserNotificationTodoSummary(event: H3Event) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    totalPending: number
    approvalPending: number
    followUpPending: number
  }>>(
    event,
    '/v1/console/notifications/todos/summary',
    { scope: 'console:notification:read', method: 'GET' }
  )
}

export async function publishConsoleCanonicalNotification(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{
    notificationId: string
    sourceAppCode: string
    recipients: string[]
    channels: string[]
    replayed: boolean
  }>>(
    event,
    '/v1/console/notifications/publish-canonical',
    { scope: 'console:notification:publish', method: 'POST', body }
  )
}

export async function advanceConsoleNotificationActionableLifecycle(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/notifications/actionable-lifecycle',
    { scope: 'console:notification:publish', method: 'POST', body }
  )
}

export async function recordConsoleNotificationDelivery(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/notifications/deliveries',
    { scope: 'console:notification:publish', method: 'POST', body }
  )
}

export async function getConsoleVaultSecrets(
  event: H3Event,
  query: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<unknown>>(
    event,
    '/v1/console/vault/secrets',
    { scope: 'console:vault-secret:view', method: 'GET', query }
  )
}

export async function createConsoleVaultSecret(
  event: H3Event,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    '/v1/console/vault/secrets',
    { scope: 'console:vault-secret:edit', method: 'POST', body }
  )
}

export async function addConsoleVaultSecretVersion(
  event: H3Event,
  secretCode: string,
  body: Record<string, unknown>,
  operation: 'versions' | 'rotate'
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/vault/secrets/${encodeURIComponent(secretCode)}/${operation}` as `/v1/console/${string}`,
    { scope: 'console:vault-secret:edit', method: 'POST', body }
  )
}

export async function revealConsoleVaultSecret(
  event: H3Event,
  secretCode: string,
  body: Record<string, unknown>
) {
  return await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/console/vault/secrets/${encodeURIComponent(secretCode)}/reveal` as `/v1/console/${string}`,
    { scope: 'console:vault-secret:reveal', method: 'POST', body }
  )
}
