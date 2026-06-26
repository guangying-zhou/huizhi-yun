import { createHash } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { resolveHzyDevApplications, type HzyDevApplication } from '@hzy/foundation/server/utils/devApplications'
import { useEvent } from 'nitropack/runtime'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { CachedPolicyBundle } from '~~/server/utils/bundleCache'
import { queryRow, withTransaction } from '~~/server/utils/db'

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

interface ClientIdRow extends RowDataPacket {
  id: number
  status?: string
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

function configuredDeploymentPublicUrl() {
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

  let clients = 0
  let redirectUris = 0
  let skippedDeletedClients = 0

  await withTransaction(async (tx) => {
    for (const app of applications) {
      let client = await tx.queryRow<ClientIdRow>(
        `SELECT id, status
           FROM auth_clients
          WHERE client_id = ?
          LIMIT 1`,
        [app.clientId]
      )

      if (client?.status === 'deleted') {
        skippedDeletedClients += 1
        continue
      }

      await tx.execute<ResultSetHeader>(
        `INSERT INTO auth_clients (
           client_id,
           client_name,
           app_code,
           client_type,
           auth_mode,
           home_url,
           logout_url,
           icon,
           description,
           source,
           source_hash,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'public', ?, ?, ?, ?, ?, 'local', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           status = CASE WHEN status = 'deleted' THEN status ELSE 'active' END,
           updated_at = UTC_TIMESTAMP()`,
        [
          app.clientId,
          app.clientName,
          app.appCode,
          app.authMode,
          app.homeUrl,
          app.logoutUrl,
          app.icon,
          app.description,
          sourceHash(app),
          app.status
        ]
      )
      clients += 1

      client = await tx.queryRow<ClientIdRow>(
        `SELECT id, status
           FROM auth_clients
          WHERE client_id = ?
          LIMIT 1`,
        [app.clientId]
      )
      if (!client || client.status === 'deleted') continue

      const desiredUris = [
        { uriType: 'redirect', redirectUri: app.callbackUrl },
        { uriType: 'post_logout', redirectUri: app.logoutUrl }
      ].filter((item): item is { uriType: 'redirect' | 'post_logout', redirectUri: string } => Boolean(item.redirectUri))

      for (const uri of desiredUris) {
        await tx.execute<ResultSetHeader>(
          `INSERT INTO auth_client_redirect_uris (
             client_id,
             uri_type,
             redirect_uri,
             source,
             status,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, 'local', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE
             source = 'local',
             status = 'active',
             updated_at = UTC_TIMESTAMP()`,
          [client.id, uri.uriType, uri.redirectUri]
        )
        redirectUris += 1
      }
    }
  })

  return {
    clients,
    redirectUris,
    skippedDeletedClients
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
  let upsertedClients = 0
  let activeRedirectUris = 0
  let inactiveBundleClients = 0
  let skippedMissingClients = 0

  await withTransaction(async (tx) => {
    if (mode === 'upsert' && seenAppCodes.length) {
      const placeholders = seenAppCodes.map(() => '?').join(', ')
      const result = await tx.execute<ResultSetHeader>(
        `UPDATE auth_clients
            SET status = 'inactive',
                updated_at = UTC_TIMESTAMP()
          WHERE source = 'bundle'
            AND app_code NOT IN (${placeholders})
            AND status = 'active'`,
        seenAppCodes
      )
      inactiveBundleClients += result.affectedRows
    } else if (mode === 'upsert') {
      const result = await tx.execute<ResultSetHeader>(
        `UPDATE auth_clients
            SET status = 'inactive',
                updated_at = UTC_TIMESTAMP()
          WHERE source = 'bundle'
            AND status = 'active'`
      )
      inactiveBundleClients += result.affectedRows
    }

    for (const app of applications) {
      let client = await tx.queryRow<ClientIdRow>(
        `SELECT id
           FROM auth_clients
          WHERE client_id = ?
          LIMIT 1`,
        [app.clientId]
      )

      if (!client && mode === 'append') {
        skippedMissingClients += 1
        continue
      }

      if (mode === 'upsert') {
        await tx.execute<ResultSetHeader>(
          `INSERT INTO auth_clients (
             client_id,
             client_name,
             app_code,
             client_type,
             auth_mode,
             home_url,
             logout_url,
             icon,
             description,
             source,
             source_hash,
             status,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE
             client_name = ${mode === 'upsert' ? 'VALUES(client_name)' : 'client_name'},
             app_code = ${mode === 'upsert' ? 'VALUES(app_code)' : 'app_code'},
             auth_mode = ${mode === 'upsert' ? 'VALUES(auth_mode)' : 'auth_mode'},
             home_url = ${mode === 'upsert' ? 'VALUES(home_url)' : 'home_url'},
             logout_url = ${mode === 'upsert' ? 'VALUES(logout_url)' : 'logout_url'},
             icon = ${mode === 'upsert' ? 'VALUES(icon)' : 'icon'},
             description = ${mode === 'upsert' ? 'VALUES(description)' : 'description'},
             source = ${mode === 'upsert' ? 'VALUES(source)' : 'source'},
             source_hash = ${mode === 'upsert' ? 'VALUES(source_hash)' : 'source_hash'},
             status = ${mode === 'upsert' ? 'VALUES(status)' : 'status'},
             updated_at = ${mode === 'upsert' ? 'UTC_TIMESTAMP()' : 'updated_at'}`,
          [
            app.clientId,
            app.clientName,
            app.appCode,
            app.authMode,
            app.homeUrl,
            app.logoutUrl,
            app.icon,
            app.description,
            clientSource,
            app.sourceHash,
            app.status
          ]
        )
        upsertedClients += 1

        client = await tx.queryRow<ClientIdRow>(
          `SELECT id
             FROM auth_clients
            WHERE client_id = ?
            LIMIT 1`,
          [app.clientId]
        )
      }
      if (!client) continue

      const desiredUris = [
        { uriType: 'redirect', redirectUri: app.callbackUrl },
        { uriType: 'post_logout', redirectUri: app.logoutUrl }
      ].filter((item): item is { uriType: 'redirect' | 'post_logout', redirectUri: string } => Boolean(item.redirectUri))

      // Keep previously materialized redirect URIs active. Shared dev/staging/prod
      // databases may intentionally allow multiple environment callback URLs for
      // the same OIDC client; stale entries should be audited and disabled
      // explicitly instead of being removed by the latest bundle refresh.
      for (const uri of desiredUris) {
        if (mode === 'upsert') {
          await tx.execute<ResultSetHeader>(
            `INSERT INTO auth_client_redirect_uris (
               client_id,
               uri_type,
               redirect_uri,
               source,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
               source = VALUES(source),
               status = VALUES(status),
               updated_at = UTC_TIMESTAMP()`,
            [client.id, uri.uriType, uri.redirectUri, clientSource, app.status]
          )
        } else {
          await tx.execute<ResultSetHeader>(
            `INSERT INTO auth_client_redirect_uris (
               client_id,
               uri_type,
               redirect_uri,
               source,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
               updated_at = updated_at`,
            [client.id, uri.uriType, uri.redirectUri, clientSource, app.status]
          )
        }
        if (app.status === 'active') activeRedirectUris += 1
      }
    }
  })

  return {
    mode,
    seenAppCodes,
    upsertedClients,
    activeRedirectUris,
    inactiveBundleClients,
    skippedMissingClients
  }
}

export async function getAuthClientCount() {
  const row = await queryRow<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
       FROM auth_clients
      WHERE status = 'active'`
  )
  return Number(row?.total || 0)
}
