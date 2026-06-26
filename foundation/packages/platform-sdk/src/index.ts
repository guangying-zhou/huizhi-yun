import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'

export type PlatformClaims = {
  iss: string
  aud: string | string[]
  sub: string
  uid: string
  tenantCode?: string
  deploymentCode?: string
  sessionId?: string
  capabilityVersion?: string
  bundleVersion?: string
  iat: number
  exp: number
  jti?: string
  raw: Record<string, unknown>
}

export type BundleMeta = {
  deploymentCode: string
  tenantCode?: string
  bundleVersion: string
  bundleHash: string
  schemaVersion: string
  bundleUri: string
  issuedAt: string
  expiresAt?: string | null
  status?: string
}

export type RevocationMeta = {
  deploymentCode: string
  tenantCode?: string
  snapshotVersion: string
  snapshotHash: string
  snapshotUri: string
  issuedAt: string
  status?: string
}

export type AuthorizationRole = {
  roleCode: string
  roleName: string
  roleType: string
  appCode?: string | null
  source: {
    type: string
    id: string | number | null
  }
}

export type AuthorizationPermission = {
  appCode: string
  resourceCode: string
  action: string
}

export type AuthorizationScope = {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
}

export type AuthorizationSnapshot = {
  uid: string
  tenantCode: string
  roles: AuthorizationRole[]
  availableRoles?: AuthorizationRole[]
  activeRoleCode?: string | null
  permissions: AuthorizationPermission[]
  scopes: AuthorizationScope[]
  sources: Array<{ type: string, id: string | number | null }>
}

export type AuthorizationMode
  = | 'merged'
    | 'role_simulation'
    | 'user_simulation'
    | 'privileged'

export type PermissionCheckInput = {
  tenantCode: string
  uid: string
  appCode: string
  resourceCode: string
  action: string
  activeRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
}

export type PermissionCheckResult = {
  allowed: boolean
  matchedAction?: string
  roles: string[]
  scopes: Array<{
    scopeType: string
    scopeValue: string
  }>
}

export type RuntimeApplication = {
  tenantCode: string | null
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  appType: string
  runtimeMode: string
  authMode: string
  bundleEnabled: boolean
  status: string
}

export type ManifestPayload = {
  appCode: string
  version: string
  manifestHash: string
  manifestJson: Record<string, unknown>
  createdAt: string
}

export type AppManifest = ManifestPayload['manifestJson']

export type PlatformHeartbeatInput = {
  tenantCode?: string
  deploymentCode: string
  runtimeId: string
  bundleVersion?: string | null
  sdkVersion?: string | null
  licenseStatusSeen?: string | null
  heartbeatAt: string
  payload?: Record<string, unknown> | null
}

export type PlatformHeartbeatResult = {
  deploymentStatus: string
  licenseStatus: string
  nextSuggestedHeartbeatAt: string
  latestBundleVersion?: string | null
}

export type PlatformSdkLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

export type PlatformSdkCache = {
  get: <T>(key: string) => Promise<T | null> | T | null
  set: <T>(key: string, value: T, ttlSeconds?: number) => Promise<void> | void
  delete?: (key: string) => Promise<void> | void
}

export type CreatePlatformSdkOptions = {
  controlPlaneBaseUrl: string
  issuer?: string
  jwksUri?: string
  fetchImpl?: typeof fetch
  cache?: PlatformSdkCache
  logger?: PlatformSdkLogger
  clock?: () => Date
  httpTimeoutMs?: number
}

export class PlatformSdkError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PlatformSdkError'
    this.code = code
  }
}

const manifestSchema = z.object({
  appCode: z.string().min(1),
  resources: z.array(z.object({
    resourceCode: z.string().min(1),
    resourceName: z.string().min(1)
  })).default([]),
  recommendedRoles: z.array(z.object({
    roleCode: z.string().min(1),
    roleName: z.string().min(1)
  })).default([])
}).passthrough()

const claimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  uid: z.string().min(1).optional(),
  tenantCode: z.string().min(1).optional(),
  companyCode: z.string().min(1).optional(),
  deploymentCode: z.string().min(1).optional(),
  deploymentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  capabilityVersion: z.string().min(1).optional(),
  bundleVersion: z.string().min(1).optional(),
  iat: z.number(),
  exp: z.number(),
  jti: z.string().min(1).optional()
}).passthrough()

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit & { fetchImpl: typeof fetch, timeoutMs: number }
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await options.fetchImpl(`${trimTrailingSlash(baseUrl)}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    })

    const payload = await response.json() as { success?: boolean, data?: T, message?: string }
    if (!response.ok || !payload?.success) {
      throw new PlatformSdkError('HTTP_ERROR', payload?.message || `request failed: ${response.status}`)
    }

    return payload.data as T
  } finally {
    clearTimeout(timeout)
  }
}

export function createPlatformSdk(options: CreatePlatformSdkOptions) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const timeoutMs = options.httpTimeoutMs || 5000

  if (!fetchImpl) {
    throw new PlatformSdkError('FETCH_UNAVAILABLE', 'fetch implementation is required')
  }

  const remoteJwks = options.jwksUri
    ? createRemoteJWKSet(new URL(options.jwksUri))
    : null

  return {
    options,
    async verifyToken(token: string): Promise<PlatformClaims> {
      if (!remoteJwks || !options.issuer) {
        throw new PlatformSdkError('SDK_MISCONFIGURED', 'issuer and jwksUri are required for verifyToken')
      }

      try {
        const { payload } = await jwtVerify(token, remoteJwks, {
          issuer: options.issuer
        })

        const claims = claimsSchema.parse(payload)

        return {
          iss: claims.iss,
          aud: claims.aud,
          sub: claims.sub,
          uid: claims.uid || claims.sub,
          tenantCode: claims.tenantCode || claims.companyCode,
          deploymentCode: claims.deploymentCode || claims.deploymentId,
          sessionId: claims.sessionId,
          capabilityVersion: claims.capabilityVersion,
          bundleVersion: claims.bundleVersion,
          iat: claims.iat,
          exp: claims.exp,
          jti: claims.jti,
          raw: payload as Record<string, unknown>
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'token verification failed'
        throw new PlatformSdkError('TOKEN_VERIFICATION_FAILED', message)
      }
    },
    async getAuthorizationSnapshot(input: { tenantCode: string, uid: string, appCode?: string | null, activeRoleCode?: string | null, authorizationMode?: AuthorizationMode | string | null }) {
      const query = new URLSearchParams({ tenantCode: input.tenantCode })
      if (input.appCode) {
        query.set('appCode', input.appCode)
      }
      if (input.activeRoleCode) {
        query.set('activeRoleCode', input.activeRoleCode)
      }
      if (input.authorizationMode) {
        query.set('authorizationMode', input.authorizationMode)
      }
      return requestJson<AuthorizationSnapshot>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/users/${encodeURIComponent(input.uid)}/authorizations?${query.toString()}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
    },
    async checkPermission(input: PermissionCheckInput) {
      return requestJson<PermissionCheckResult>(
        options.controlPlaneBaseUrl,
        '/api/platform/runtime/permissions/check',
        {
          method: 'POST',
          body: JSON.stringify(input),
          fetchImpl,
          timeoutMs
        }
      )
    },
    async getManifest(input: { tenantCode: string, appCode: string }) {
      const query = new URLSearchParams({ tenantCode: input.tenantCode })
      const manifest = await requestJson<ManifestPayload>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/applications/${encodeURIComponent(input.appCode)}/manifest?${query.toString()}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
      return {
        ...manifest,
        manifestJson: manifestSchema.parse(manifest.manifestJson)
      }
    },
    async listApplications(input: { tenantCode: string, status?: string }) {
      const query = new URLSearchParams({ tenantCode: input.tenantCode })
      if (input.status) {
        query.set('status', input.status)
      }
      const result = await requestJson<{ items: RuntimeApplication[] }>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/applications?${query.toString()}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
      return result.items
    },
    async getBundleMeta(input: { deploymentCode: string, tenantCode?: string }) {
      const query = new URLSearchParams()
      if (input.tenantCode) {
        query.set('tenantCode', input.tenantCode)
      }
      return requestJson<BundleMeta>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/deployments/${encodeURIComponent(input.deploymentCode)}/bundle-meta${query.size ? `?${query.toString()}` : ''}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
    },
    async getBundle(input: { deploymentCode: string, tenantCode?: string, uid?: string, appCode?: string }) {
      const query = new URLSearchParams()
      if (input.tenantCode) query.set('tenantCode', input.tenantCode)
      if (input.uid) query.set('uid', input.uid)
      if (input.appCode) query.set('appCode', input.appCode)
      return requestJson<Record<string, unknown>>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/deployments/${encodeURIComponent(input.deploymentCode)}/bundle${query.size ? `?${query.toString()}` : ''}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
    },
    async getRevocationMeta(input: { deploymentCode: string, tenantCode?: string }) {
      const query = new URLSearchParams()
      if (input.tenantCode) query.set('tenantCode', input.tenantCode)
      return requestJson<RevocationMeta>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/deployments/${encodeURIComponent(input.deploymentCode)}/revocation-meta${query.size ? `?${query.toString()}` : ''}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
    },
    async getRevocations(input: { deploymentCode: string, tenantCode?: string }) {
      const query = new URLSearchParams()
      if (input.tenantCode) query.set('tenantCode', input.tenantCode)
      return requestJson<Record<string, unknown>>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/deployments/${encodeURIComponent(input.deploymentCode)}/revocations${query.size ? `?${query.toString()}` : ''}`,
        { method: 'GET', fetchImpl, timeoutMs }
      )
    },
    async heartbeat(input: PlatformHeartbeatInput) {
      const query = new URLSearchParams()
      if (input.tenantCode) query.set('tenantCode', input.tenantCode)
      return requestJson<PlatformHeartbeatResult>(
        options.controlPlaneBaseUrl,
        `/api/platform/runtime/deployments/${encodeURIComponent(input.deploymentCode)}/heartbeat${query.size ? `?${query.toString()}` : ''}`,
        {
          method: 'POST',
          body: JSON.stringify({
            runtimeId: input.runtimeId,
            bundleVersion: input.bundleVersion,
            sdkVersion: input.sdkVersion,
            licenseStatusSeen: input.licenseStatusSeen,
            heartbeatAt: input.heartbeatAt,
            payload: input.payload || null
          }),
          fetchImpl,
          timeoutMs
        }
      )
    },
    validateManifest(manifest: Record<string, unknown>) {
      return manifestSchema.parse(manifest)
    }
  }
}

export type PlatformSdk = ReturnType<typeof createPlatformSdk>
