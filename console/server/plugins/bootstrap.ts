import { getCachedBundleInvalidReason, getRuntimeCacheDescriptor, patchActivationStatus, persistentPolicyStoreEnabled, readCachedBundle } from '~~/server/utils/bundleCache'
import {
  isManagedCloudMultitenantActivation,
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  postPlatformHeartbeat,
  readAndVerifyLicense,
  resolvePlatformBundleCacheDir,
  refreshPlatformBundle
} from '~~/server/utils/platformRuntime'
import { materializeAuthClientsFromBundle, materializeLocalDevAuthClients } from '~~/server/utils/authClients'

const HEARTBEAT_TIMER_KEY = '__hzy_console_platform_heartbeat_timer__'

type RuntimeGlobal = typeof globalThis & {
  [HEARTBEAT_TIMER_KEY]?: ReturnType<typeof setInterval>
}

async function heartbeatOnce() {
  const config = loadPlatformRuntimeConfig()
  if (!config.heartbeatEnabled) {
    return
  }

  const bundle = await readCachedBundle(config.bundleCacheDir)
  const heartbeat = await postPlatformHeartbeat(config, bundle)
  await patchActivationStatus(config.bundleCacheDir, {
    lastHeartbeatAt: new Date().toISOString()
  })

  const shouldDownloadBundle = heartbeat.data?.actions?.some(action => action.type === 'download_bundle')
  if (!shouldDownloadBundle) {
    return
  }

  const result = await refreshPlatformBundle('heartbeat-action')
  if (result.ok) {
    console.info(`[console] platform policy bundle refreshed from heartbeat action: version=${result.bundle?.bundleVersion || 'unknown'}, authClients=${result.authClientMaterialization?.upsertedClients ?? 0}, authClientMode=${result.authClientMaterialization?.mode || 'skipped'}, authClientSkipped=${result.authClientMaterialization?.skippedMissingClients ?? 0}`)
    return
  }

  console.warn(`[console] platform policy bundle refresh from heartbeat action failed: ${result.error}`)
}

function startHeartbeatLoop(intervalMs: number) {
  const runtimeGlobal = globalThis as RuntimeGlobal
  if (runtimeGlobal[HEARTBEAT_TIMER_KEY]) {
    return
  }

  const timer = setInterval(() => {
    heartbeatOnce().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[console] platform heartbeat failed: ${message}`)
    })
  }, intervalMs)
  timer.unref?.()
  runtimeGlobal[HEARTBEAT_TIMER_KEY] = timer
}

function logRuntimeMode(cacheDir: string) {
  const mode = loadConsoleRuntimeMode()
  const cache = getRuntimeCacheDescriptor(cacheDir)
  const cacheInfo = cache.backend === 'file'
    ? `cacheBackend=file, cacheDir=${cache.cacheDir}`
    : `cacheBackend=${cache.backend}, cacheScope=${cache.scope || '<none>'}`

  console.info(
    `[console] runtime mode: activationMode=${mode.activationMode}, runMode=${mode.runMode}, platformRuntime=${mode.runtimeEnabled ? 'enabled' : 'disabled'}, heartbeat=${mode.heartbeatEnabled ? 'enabled' : 'disabled'}, bundleRefreshOnBoot=${mode.bundleRefreshOnBoot ? 'enabled' : 'disabled'}, authClientMaterialize=${mode.authClientMaterializeEnabled ? 'enabled' : 'disabled'}, backgroundJobs=${mode.backgroundJobsEnabled ? 'enabled' : 'disabled'}, tenantGatewayTrust=${mode.trustTenantGateway ? 'enabled' : 'disabled'}, ${cacheInfo}`
  )
}

function startHeartbeatLoopIfEnabled(config: { heartbeatEnabled: boolean, heartbeatIntervalMs: number }) {
  if (config.heartbeatEnabled) {
    startHeartbeatLoop(config.heartbeatIntervalMs)
  }
}

export default defineNitroPlugin(async () => {
  const runtimeMode = loadConsoleRuntimeMode()
  const cacheDir = resolvePlatformBundleCacheDir()
  logRuntimeMode(cacheDir)

  if (!runtimeMode.runtimeEnabled) {
    if (runtimeMode.devPolicyBypassEnabled) {
      await materializeLocalDevAuthClients()
        .then((result) => {
          console.info(`[console] local dev auth clients materialized: clients=${result.clients}, redirectUris=${result.redirectUris}, skippedDeletedClients=${result.skippedDeletedClients}`)
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[console] local dev auth client materialization failed: ${message}`)
        })
    }
    console.info('[console] platform runtime bootstrap skipped because HZY_PLATFORM_RUNTIME_ENABLED=false')
    return
  }

  const config = loadPlatformRuntimeConfig()
  const managedCloudMultitenant = isManagedCloudMultitenantActivation()

  if (managedCloudMultitenant) {
    // Persistent readiness belongs to a verified tenant request, not process
    // startup. Patching it would read a tenant snapshot without an H3 event.
    if (!persistentPolicyStoreEnabled()) {
      await patchActivationStatus(config.bundleCacheDir, {
        mode: 'pending',
        activated: false,
        envValid: true,
        licenseValid: true,
        bundleReady: false,
        tenantCode: null,
        deploymentCode: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null
      }, 'managed-cloud-console:global')
    }
    console.info('[console] managed-cloud multitenant bootstrap ready; tenant policy readiness requires trusted Tenant Gateway context')
    return
  }

  try {
    await readAndVerifyLicense(config)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await patchActivationStatus(config.bundleCacheDir, {
      mode: 'failed',
      activated: false,
      envValid: true,
      licenseValid: false,
      bundleReady: false,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode,
      lastCheckedAt: new Date().toISOString(),
      lastError: message
    })
    throw createError({
      statusCode: 500,
      statusMessage: 'Console license verification failed',
      message
    })
  }

  await patchActivationStatus(config.bundleCacheDir, {
    mode: 'pending',
    activated: false,
    envValid: true,
    licenseValid: true,
    tenantCode: config.tenantCode,
    deploymentCode: config.deploymentCode,
    lastCheckedAt: new Date().toISOString(),
    lastError: null
  })

  console.info('[console] tenant background jobs are owned by tenant data-runtime; Console startup does not scan tenant Directory data')

  const cachedBundle = await readCachedBundle(config.bundleCacheDir)
  if (cachedBundle) {
    const invalidReason = getCachedBundleInvalidReason(cachedBundle)
    if (!invalidReason) {
      if (config.authClientMaterializeEnabled) {
        await materializeAuthClientsFromBundle(cachedBundle)
          .then((result) => {
            console.info(`[console] auth clients materialized from cached policy bundle: mode=${result.mode}, clients=${result.upsertedClients}, redirectUris=${result.activeRedirectUris}, skippedMissingClients=${result.skippedMissingClients}`)
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[console] auth client materialization from cached policy bundle failed: ${message}`)
          })
      }

      await patchActivationStatus(config.bundleCacheDir, {
        mode: 'active',
        activated: true,
        bundleReady: true,
        bundleVersion: cachedBundle.bundleVersion,
        bundleHash: cachedBundle.bundleHash,
        lastActivatedAt: cachedBundle.cachedAt,
        lastError: null
      })
    } else {
      console.warn(`[console] cached platform policy bundle is not usable: ${invalidReason}`)
    }

    if (!config.bundleRefreshOnBoot) {
      if (invalidReason) {
        console.warn('[console] startup policy bundle refresh skipped and cached bundle is not usable')
        return
      }
      startHeartbeatLoopIfEnabled(config)
      return
    }

    const refreshResult = await refreshPlatformBundle(invalidReason ? 'startup-invalid-cache' : 'startup-refresh')
    if (refreshResult.ok) {
      console.info(`[console] platform policy bundle refreshed on startup: version=${refreshResult.bundle?.bundleVersion || 'unknown'}, authClients=${refreshResult.authClientMaterialization?.upsertedClients ?? 0}, authClientMode=${refreshResult.authClientMaterialization?.mode || 'skipped'}, authClientSkipped=${refreshResult.authClientMaterialization?.skippedMissingClients ?? 0}`)
      startHeartbeatLoopIfEnabled(config)
      return
    }

    if (invalidReason) {
      console.warn(`[console] platform bundle activation pending: ${refreshResult.error}`)
      return
    }

    console.warn(`[console] startup policy bundle refresh failed, using cached bundle: ${refreshResult.error}`)
    if (config.heartbeatEnabled) {
      await postPlatformHeartbeat(config, cachedBundle)
        .then(async () => {
          await patchActivationStatus(config.bundleCacheDir, {
            lastHeartbeatAt: new Date().toISOString()
          })
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[console] platform heartbeat failed on startup: ${message}`)
        })
    }
    startHeartbeatLoopIfEnabled(config)
    return
  }

  if (!config.bundleRefreshOnBoot) {
    console.warn('[console] startup policy bundle refresh skipped and no cached bundle is available')
    return
  }

  const result = await refreshPlatformBundle('startup')
  if (!result.ok) {
    console.warn(`[console] platform bundle activation pending: ${result.error}`)
    return
  }

  startHeartbeatLoopIfEnabled(config)
})
