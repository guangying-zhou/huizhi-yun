import type { H3Event } from 'h3'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import { patchActivationStatus, readCachedBundle } from '~~/server/utils/bundleCache'
import {
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  postPlatformHeartbeat,
  resolvePlatformRuntimeCacheScope,
  refreshPlatformBundle
} from '~~/server/utils/platformRuntime'

type BundleAction = {
  type: string
  version: string
}

function noStore(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')
}

function findBundleAction(actions: unknown): BundleAction | null {
  if (!Array.isArray(actions)) return null

  for (const action of actions) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) continue
    const typedAction = action as Partial<BundleAction>
    if (typedAction.type === 'download_bundle' && typedAction.version) {
      return {
        type: typedAction.type,
        version: String(typedAction.version)
      }
    }
  }

  return null
}

export default defineEventHandler(async (event) => {
  noStore(event)
  await resolveConsoleSession(event, { touch: false })

  const runtimeMode = loadConsoleRuntimeMode(event)
  if (!runtimeMode.runtimeEnabled) {
    return {
      code: 0,
      message: 'platform runtime disabled',
      data: {
        checked: false,
        refreshRequired: false,
        refreshed: false,
        currentBundleVersion: null,
        latestBundleVersion: null
      }
    }
  }

  const config = loadPlatformRuntimeConfig(event)
  const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
  const currentBundle = await readCachedBundle(config.bundleCacheDir, cacheScope)
  if (config.activationMode === 'managed-cloud-multitenant') {
    const result = await refreshPlatformBundle('admin-open-refresh', event)
    return {
      code: result.ok ? 0 : 1,
      message: result.error || 'ok',
      data: {
        checked: true,
        refreshRequired: true,
        refreshed: result.ok,
        requestedBundleVersion: null,
        previousBundleVersion: currentBundle?.bundleVersion || null,
        bundleVersion: result.bundle?.bundleVersion || result.status.bundleVersion || null,
        bundleHash: result.bundle?.bundleHash || result.status.bundleHash || null
      }
    }
  }

  if (!config.heartbeatEnabled) {
    return {
      code: 0,
      message: 'platform heartbeat disabled',
      data: {
        checked: false,
        refreshRequired: false,
        refreshed: false,
        currentBundleVersion: currentBundle?.bundleVersion || null,
        latestBundleVersion: currentBundle?.bundleVersion || null
      }
    }
  }

  const heartbeat = await postPlatformHeartbeat(config, currentBundle)
  await patchActivationStatus(config.bundleCacheDir, {
    lastHeartbeatAt: new Date().toISOString()
  }, cacheScope)

  const heartbeatData = heartbeat.data as {
    actions?: unknown
    latestBundleVersion?: string | null
  } | undefined
  const bundleAction = findBundleAction(heartbeatData?.actions)

  if (!bundleAction) {
    return {
      code: 0,
      message: 'ok',
      data: {
        checked: true,
        refreshRequired: false,
        refreshed: false,
        currentBundleVersion: currentBundle?.bundleVersion || null,
        latestBundleVersion: heartbeatData?.latestBundleVersion || currentBundle?.bundleVersion || null
      }
    }
  }

  const result = await refreshPlatformBundle('admin-open-refresh', event)

  return {
    code: result.ok ? 0 : 1,
    message: result.error || 'ok',
    data: {
      checked: true,
      refreshRequired: true,
      refreshed: result.ok,
      requestedBundleVersion: bundleAction.version,
      previousBundleVersion: currentBundle?.bundleVersion || null,
      bundleVersion: result.bundle?.bundleVersion || result.status.bundleVersion || null,
      bundleHash: result.bundle?.bundleHash || result.status.bundleHash || null
    }
  }
})
