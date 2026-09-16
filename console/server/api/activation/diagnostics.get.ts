import type { H3Event } from 'h3'
import { createError, defineEventHandler, getHeader, setHeader } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getConsoleAuthRuntimeHealth } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getRuntimeCacheDescriptor, readCachedBundle } from '~~/server/utils/bundleCache'
import {
  loadActivationStatus,
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  resolvePlatformBundleCacheDir,
  resolvePlatformRuntimeCacheScope
} from '~~/server/utils/platformRuntime'
import { resolveAuthClientMaterializeMode } from '~~/server/utils/authClients'
import { getPublicConsoleCollabRuntimeState } from '~~/server/utils/collabRuntime'

type CloudflareRuntimeEnv = Record<string, string | undefined>
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

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv(event: H3Event) {
  const runtimeEvent = event as unknown as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__env__
    || {}
}

function runtimeEnvValue(event: H3Event, ...keys: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const key of keys) {
    const value = stringValue(cloudflareEnv[key] || process.env[key])
    if (value) return value
  }
  return ''
}

function runtimeEnvBoolean(event: H3Event, key: string, fallback: boolean) {
  const value = runtimeEnvValue(event, key).toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function bearerToken(value: unknown) {
  const match = stringValue(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function normalizeHost(value: unknown) {
  const host = stringValue(value).toLowerCase()
  if (!host) return ''
  if (host.startsWith('[')) {
    return host.slice(1, host.indexOf(']'))
  }
  return host.split(':')[0]
}

function normalizeIp(value: unknown) {
  return stringValue(value)
    .replace(/^::ffff:/i, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
}

function isLoopbackAddress(value: unknown) {
  const ip = normalizeIp(value)
  return ip === 'localhost'
    || ip === '::1'
    || ip === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(ip)
}

function hasDiagnosticsToken(event: H3Event) {
  const expected = runtimeEnvValue(event, 'HZY_CONSOLE_DIAGNOSTICS_TOKEN', 'CONSOLE_DIAGNOSTICS_TOKEN')
  if (!expected) return false

  const actual = bearerToken(getHeader(event, 'authorization'))
    || stringValue(getHeader(event, 'x-hzy-diagnostics-token'))
  return actual === expected
}

function isLocalRequest(event: H3Event) {
  const host = normalizeHost(getHeader(event, 'host'))
  if (!isLoopbackAddress(host)) {
    return false
  }

  const forwardedFor = stringValue(getHeader(event, 'x-forwarded-for'))
  if (forwardedFor) {
    return isLoopbackAddress(forwardedFor.split(',')[0])
  }

  return isLoopbackAddress(event.node?.req?.socket?.remoteAddress)
}

function assertDiagnosticsAccess(event: H3Event) {
  if (hasDiagnosticsToken(event) || isLocalRequest(event)) {
    return
  }

  throw createError({
    statusCode: 403,
    statusMessage: 'Diagnostics Forbidden',
    message: 'runtime diagnostics require loopback access or HZY_CONSOLE_DIAGNOSTICS_TOKEN'
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function loadTenantRuntimeAuthSnapshot(event: H3Event) {
  try {
    const health = await getConsoleAuthRuntimeHealth(event)
    const checkedAt = new Date().toISOString()
    const signingKid = stringValue(health.data?.signingKid)
    return {
      database: {
        connected: true,
        configuredName: 'tenant-runtime',
        databaseName: null,
        checkedAt,
        error: null
      },
      signingKey: {
        currentKeyPresent: Boolean(signingKid),
        kid: signingKid || null,
        alg: signingKid ? 'EdDSA' : null,
        useType: signingKid ? 'sig' : null,
        privateKeyRefType: signingKid ? 'tenant-runtime-vault' : null,
        privateKeyUsable: Boolean(signingKid),
        error: health.data?.lastAuthError || null
      }
    }
  } catch (error) {
    return {
      database: {
        connected: false,
        configuredName: 'tenant-runtime',
        databaseName: null,
        checkedAt: null,
        error: errorMessage(error)
      },
      signingKey: {
        currentKeyPresent: false,
        kid: null,
        alg: null,
        useType: null,
        privateKeyRefType: null,
        privateKeyUsable: false,
        error: errorMessage(error)
      }
    }
  }
}

function loadPlatformSnapshot(event: H3Event) {
  try {
    const config = loadPlatformRuntimeConfig(event)
    return {
      configured: true,
      activationMode: config.activationMode,
      baseUrl: config.baseUrl,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode,
      environment: config.environment,
      signingKid: config.signingKid,
      runtimeTokenConfigured: Boolean(config.runtimeToken),
      platformServiceTokenConfigured: Boolean(config.platformServiceToken),
      signingPubkeyConfigured: Boolean(config.signingPubkey),
      licenseTokenConfigured: Boolean(config.licenseToken),
      licensePathConfigured: Boolean(config.licensePath),
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      error: null
    }
  } catch (error) {
    return {
      configured: false,
      activationMode: null,
      baseUrl: null,
      tenantCode: null,
      deploymentCode: null,
      environment: null,
      signingKid: null,
      runtimeTokenConfigured: false,
      platformServiceTokenConfigured: false,
      signingPubkeyConfigured: false,
      licenseTokenConfigured: false,
      licensePathConfigured: false,
      heartbeatIntervalMs: null,
      error: errorMessage(error)
    }
  }
}

async function loadBundleSnapshot(cacheDir: string, scope?: string | null) {
  try {
    const bundle = await readCachedBundle(cacheDir, scope)
    if (!bundle) {
      return {
        ready: false,
        tenantCode: null,
        deploymentCode: null,
        bundleVersion: null,
        bundleHash: null,
        kid: null,
        cachedAt: null,
        error: null
      }
    }

    return {
      ready: true,
      tenantCode: bundle.tenantCode,
      deploymentCode: bundle.deploymentCode,
      bundleVersion: bundle.bundleVersion,
      bundleHash: bundle.bundleHash,
      kid: bundle.kid,
      cachedAt: bundle.cachedAt,
      error: null
    }
  } catch (error) {
    return {
      ready: false,
      tenantCode: null,
      deploymentCode: null,
      bundleVersion: null,
      bundleHash: null,
      kid: null,
      cachedAt: null,
      error: errorMessage(error)
    }
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  assertDiagnosticsAccess(event)

  const runtimeMode = loadConsoleRuntimeMode(event)
  const cacheDir = resolvePlatformBundleCacheDir(event)
  const platformConfig = loadPlatformSnapshot(event)
  const cacheScope = platformConfig.configured
    ? resolvePlatformRuntimeCacheScope({
        activationMode: platformConfig.activationMode || 'standalone',
        tenantCode: platformConfig.tenantCode || '',
        environment: platformConfig.environment || 'prod'
      }, event)
    : null
  const cache = getRuntimeCacheDescriptor(cacheDir, cacheScope)
  const [activation, bundle, tenantRuntimeAuth] = await Promise.all([
    loadActivationStatus(event),
    loadBundleSnapshot(cacheDir, cacheScope),
    loadTenantRuntimeAuthSnapshot(event)
  ])
  const config = useRuntimeConfig(event)

  return {
    code: 0,
    data: {
      checkedAt: new Date().toISOString(),
      process: {
        nodeEnv: process.env.NODE_ENV || null,
        pm2Name: runtimeEnvValue(event, 'HZY_CONSOLE_PM2_NAME', 'PM2_NAME') || null,
        host: runtimeEnvValue(event, 'HOST', 'NITRO_HOST') || null,
        port: runtimeEnvValue(event, 'PORT', 'NITRO_PORT') || null,
        deploymentPublicUrl: runtimeEnvValue(
          event,
          'HZY_DEPLOYMENT_PUBLIC_URL',
          'NUXT_PUBLIC_SITE_URL',
          'HZY_CONSOLE_URL',
          'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL',
          'NUXT_PUBLIC_CONSOLE_URL'
        ) || stringValue(config.public?.deploymentPublicUrl) || null
      },
      runtime: runtimeMode,
      auth: {
        clientMaterializeMode: runtimeMode.authClientMaterializeEnabled
          ? resolveAuthClientMaterializeMode()
          : 'disabled',
        signingKeyAutogenerate: runtimeEnvBoolean(event, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', false),
        signingKeyRotateUnusable: runtimeEnvBoolean(event, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', false),
        signingKey: tenantRuntimeAuth.signingKey
      },
      collab: getPublicConsoleCollabRuntimeState(),
      platform: platformConfig,
      database: tenantRuntimeAuth.database,
      cache,
      activation,
      bundle
    }
  }
})
