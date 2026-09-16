import { createHash } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { resolveHzyDevApplications, type HzyDevApplication } from '@hzy/foundation/server/utils/devApplications'
import {
  getConsoleAuthRuntimeHealth,
  materializeConsoleAuthClients,
  type ConsoleAuthClientMaterialization
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { useEvent } from 'nitropack/runtime'
import type { CachedPolicyBundle } from '~~/server/utils/bundleCache'
import { getBackgroundRuntimeEvent } from '~~/server/utils/backgroundRuntimeEvent'

type BundleRecord = Record<string, unknown>
type CloudflareRuntimeEnv = Record<string, unknown>
type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
  }
}
type CloudflareGlobal = typeof globalThis & {
  __env__?: CloudflareRuntimeEnv
}

export interface AuthClientMaterializeResult {
  mode: AuthClientMaterializeMode
  seenAppCodes: string[]
  upsertedClients: number
  activeRedirectUris: number
  inactiveBundleClients: number
  skippedMissingClients: number
}

export type AuthClientMaterializeMode = 'upsert' | 'append'

export interface LocalDevAuthClientMaterializeResult {
  clients: number
  redirectUris: number
  skippedDeletedClients: number
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv() {
  try {
    const event = useEvent() as unknown as CloudflareRuntimeEvent
    return event.context?.cloudflare?.env
      || event.context?._platform?.cloudflare?.env
      || event.context?.nitro?.env
      || event.req?.runtime?.cloudflare?.env
      || (globalThis as CloudflareGlobal).__env__
      || {}
  } catch {
    return (globalThis as CloudflareGlobal).__env__ || {}
  }
}

function runtimeEnvValue(...names: string[]) {
  const cloudflareEnv = getCloudflareEnv()
  for (const name of names) {
    const value = stringValue(cloudflareEnv[name] || process.env[name])
    if (value) return value
  }
  return ''
}

function runtimeConfigPublicValue(name: string) {
  try {
    const config = useRuntimeConfig() as unknown as { public?: Record<string, unknown> }
    return stringValue(config.public?.[name])
  } catch {
    return ''
  }
}

function runtimeConfigConsoleValue(name: string) {
  try {
    const config = useRuntimeConfig() as unknown as { consoleRuntime?: Record<string, unknown> }
    return stringValue(config.consoleRuntime?.[name])
  } catch {
    return ''
  }
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function normalizePublicUrl(value: unknown) {
  const normalized = stringValue(value).replace(/\/+$/, '')
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function normalizeHomeUrl(value: unknown) {
  const normalized = normalizePublicUrl(value)
  return normalized ? `${normalized}/` : null
}

function normalizeBasePath(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized) return null
  if (normalized === '/') return '/'
  if (!normalized.startsWith('/')) return null
  if (normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) return null
  if (/\s/.test(normalized) || normalized.includes('..') || normalized.includes('//')) return null
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function defaultAppBasePath(appCode: string) {
  return appCode === 'console' ? '/' : `/${appCode}/`
}

export function configuredDeploymentPublicUrl() {
  return normalizePublicUrl(
    runtimeEnvValue(
      'HZY_DEPLOYMENT_PUBLIC_URL',
      'HZY_CONSOLE_URL',
      'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL',
      'NUXT_PUBLIC_CONSOLE_URL'
    )
    || runtimeConfigPublicValue('deploymentPublicUrl')
  )
}

function buildAppHomeUrl(publicUrl: unknown, basePath: unknown) {
  const origin = normalizePublicUrl(publicUrl)
  const path = normalizeBasePath(basePath)
  if (!origin || !path) return null
  return `${origin}${path === '/' ? '/' : path}`
}

function deriveOidcCallbackUrl(homeUrl: unknown) {
  const normalized = stringValue(homeUrl)
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.search = ''
    url.hash = ''

    return `${url.toString().replace(/\/+$/, '')}/api/auth/oidc-callback`
  } catch {
    return null
  }
}

function deriveOidcLogoutUrl(homeUrl: unknown) {
  const normalized = stringValue(homeUrl)
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.search = ''
    url.hash = ''

    return `${url.toString().replace(/\/+$/, '')}/api/auth/oidc-post-logout`
  } catch {
    return null
  }
}

function defaultLocalConsoleHomeUrl() {
  const port = runtimeEnvValue('HZY_CONSOLE_DEV_PORT', 'HZY_DEV_CONSOLE_PORT') || '3000'
  const explicit = normalizeHomeUrl(runtimeEnvValue('HZY_CONSOLE_DEV_URL', 'HZY_LOCAL_CONSOLE_URL'))
  if (explicit) return explicit

  const basePath = normalizeBasePath(
    runtimeEnvValue('HZY_APP_BASE_PATH', 'NUXT_APP_BASE_URL')
    || runtimeConfigPublicValue('appBasePath')
    || '/'
  ) || '/'

  return buildAppHomeUrl(`http://localhost:${port}`, basePath) || 'http://localhost:3000/'
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sourceHash(value: unknown) {
  return `sha256_${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function isActive(value: unknown) {
  const normalized = stringValue(value)
  return !normalized || normalized === 'active'
}

function normalizeAuthMode(value: unknown) {
  const mode = stringValue(value) || 'oidc'
  return ['oidc', 'legacy', 'mixed'].includes(mode) ? mode : 'oidc'
}

export function resolveAuthClientMaterializeMode(): AuthClientMaterializeMode {
  const configured = stringValue(
    runtimeEnvValue(
      'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE',
      'HZY_AUTH_CLIENT_MATERIALIZE_MODE',
      'AUTH_CLIENT_MATERIALIZE_MODE'
    )
  ).toLowerCase()

  if (['append', 'append_redirects', 'redirects_only'].includes(configured)) {
    return 'append'
  }
  if (['upsert', 'full', 'replace'].includes(configured)) {
    return 'upsert'
  }

  const runMode = stringValue(
    runtimeEnvValue('HZY_CONSOLE_RUN_MODE', 'CONSOLE_RUN_MODE')
    || runtimeConfigConsoleValue('runMode')
  ).toLowerCase()
  return runMode === 'test' ? 'append' : 'upsert'
}

function normalizeApplication(record: BundleRecord, deploymentPublicUrl?: string | null) {
  const appCode = stringValue(record.appCode)
  if (!appCode) return null

  const status = isActive(record.status) ? 'active' : 'inactive'
  const authMode = normalizeAuthMode(record.authMode)
  const basePath = normalizeBasePath(record.basePath) || defaultAppBasePath(appCode)
  const deploymentHomeUrl = buildAppHomeUrl(deploymentPublicUrl, basePath)
  const configuredHomeUrl = buildAppHomeUrl(configuredDeploymentPublicUrl(), basePath)
  const homeUrl = deploymentHomeUrl || nullableString(record.homeUrl) || configuredHomeUrl
  const callbackUrl = deploymentHomeUrl
    ? deriveOidcCallbackUrl(deploymentHomeUrl)
    : nullableString(record.callbackUrl) || deriveOidcCallbackUrl(homeUrl)
  const logoutUrl = deploymentHomeUrl
    ? deriveOidcLogoutUrl(deploymentHomeUrl)
    : nullableString(record.logoutUrl) || deriveOidcLogoutUrl(homeUrl)

  return {
    appCode,
    clientId: appCode,
    clientName: stringValue(record.appName) || appCode,
    description: nullableString(record.description),
    icon: nullableString(record.icon),
    homeUrl,
    callbackUrl,
    logoutUrl,
    authMode,
    status,
    sourceHash: sourceHash({
      appCode,
      appName: stringValue(record.appName) || appCode,
      description: nullableString(record.description),
      icon: nullableString(record.icon),
      basePath,
      homeUrl,
      callbackUrl,
      logoutUrl,
      authMode,
      status
    })
  }
}

function normalizeLocalDevApplication(record: HzyDevApplication | BundleRecord) {
  const appCode = stringValue(record.appCode)
  if (!appCode) return null

  const homeUrl = normalizeHomeUrl(record.homeUrl)
  if (!homeUrl) return null

  const status = isActive(record.status) ? 'active' : 'inactive'
  const authMode = normalizeAuthMode('authMode' in record ? record.authMode : 'oidc')

  return {
    appCode,
    clientId: appCode,
    clientName: stringValue(record.appName) || appCode,
    description: nullableString(record.description),
    icon: nullableString(record.icon),
    homeUrl,
    callbackUrl: deriveOidcCallbackUrl(homeUrl),
    logoutUrl: deriveOidcLogoutUrl(homeUrl),
    authMode,
    status
  }
}

function localConsoleApplication(): HzyDevApplication {
  return {
    appCode: 'console',
    appName: runtimeConfigPublicValue('appDisplayName') || runtimeConfigPublicValue('appName') || '企业控制台',
    description: '企业控制台',
    icon: runtimeConfigPublicValue('appIcon') || 'i-lucide-monitor-cog',
    homeUrl: defaultLocalConsoleHomeUrl(),
    sortOrder: 0,
    appType: 'base_runtime',
    serviceRole: 'supporting_service',
    status: 'active'
  }
}

export async function materializeLocalDevAuthClients(): Promise<LocalDevAuthClientMaterializeResult> {
  const applications = [localConsoleApplication(), ...resolveHzyDevApplications()]
    .map(normalizeLocalDevApplication)
    .filter((item): item is NonNullable<ReturnType<typeof normalizeLocalDevApplication>> => Boolean(item))
  const materializations: ConsoleAuthClientMaterialization[] = applications.map(app => ({
    ...app,
    sourceHash: sourceHash(app)
  }))
  const response = await materializeConsoleAuthClients(
    getBackgroundRuntimeEvent(),
    { mode: 'local', source: 'local', applications: materializations },
    `console:auth-client:local:${sourceHash(materializations).replace(/^sha256_/, '')}`
  )
  return {
    clients: Number(response.data.clients || 0),
    redirectUris: Number(response.data.redirectUris || 0),
    skippedDeletedClients: Number(response.data.skippedDeletedClients || 0)
  }
}

export async function materializeAuthClientsFromBundle(bundle: CachedPolicyBundle): Promise<AuthClientMaterializeResult> {
  const mode = resolveAuthClientMaterializeMode()
  const clientSource = mode === 'append' ? 'bundle_test' : 'bundle'
  const deployment = bundle.payload?.deployment as Record<string, unknown> | undefined
  const deploymentPublicUrl = nullableString(deployment?.publicUrl)
  const applications = records(bundle.payload?.applications)
    .map(record => normalizeApplication(record, deploymentPublicUrl))
    .filter((item): item is NonNullable<ReturnType<typeof normalizeApplication>> => Boolean(item))

  const seenAppCodes = [...new Set(applications.map(item => item.appCode))].sort()
  const response = await materializeConsoleAuthClients(
    getBackgroundRuntimeEvent(),
    {
      mode,
      source: clientSource,
      applications
    },
    `console:auth-client:${clientSource}:${sourceHash({ mode, applications }).replace(/^sha256_/, '')}`
  )
  return {
    mode,
    seenAppCodes,
    upsertedClients: Number(response.data.upsertedClients || 0),
    activeRedirectUris: Number(response.data.activeRedirectUris || 0),
    inactiveBundleClients: Number(response.data.inactiveBundleClients || 0),
    skippedMissingClients: Number(response.data.skippedMissingClients || 0)
  }
}

export async function getAuthClientCount() {
  const response = await getConsoleAuthRuntimeHealth(getBackgroundRuntimeEvent())
  return Number(response.data.activeClients || 0)
}
