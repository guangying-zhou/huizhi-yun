import {
  patchPlatformActivationStatus,
  readCachedPlatformBundle
} from '../utils/platformActivationCache'
import {
  loadPlatformActivationConfig,
  postPlatformRuntimeHeartbeat,
  readAndVerifyPlatformLicense,
  refreshPlatformPolicyBundle,
  resolvePlatformActivationConfig
} from '../utils/platformActivationRuntime'

const HEARTBEAT_TIMER_KEY = '__hzy_foundation_platform_activation_heartbeat_timer__'

type RuntimeGlobal = typeof globalThis & {
  [HEARTBEAT_TIMER_KEY]?: ReturnType<typeof setInterval>
}

function log(message: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[foundation.platform] ${message}`, detail)
    return
  }
  console.info(`[foundation.platform] ${message}`)
}

function warn(message: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.warn(`[foundation.platform] ${message}`, detail)
    return
  }
  console.warn(`[foundation.platform] ${message}`)
}

async function heartbeatOnce() {
  const config = await resolvePlatformActivationConfig()
  if (!config.enabled || config.missing.length) {
    return
  }

  const bundle = await readCachedPlatformBundle(config.bundleCacheDir)
  const heartbeat = await postPlatformRuntimeHeartbeat(config, bundle)
  await patchPlatformActivationStatus(config.bundleCacheDir, {
    lastHeartbeatAt: new Date().toISOString()
  })

  const shouldDownloadBundle = heartbeat.data?.actions?.some(action => action.type === 'download_bundle')
  if (shouldDownloadBundle) {
    const result = await refreshPlatformPolicyBundle('heartbeat-action')
    if (result.ok) {
      log('policy bundle refreshed from heartbeat action', {
        bundleVersion: result.bundle?.bundleVersion || null,
        bundleHash: result.bundle?.bundleHash || null
      })
    } else {
      warn(`policy bundle refresh from heartbeat action failed: ${result.error}`)
    }
  }
}

function startHeartbeatLoop(intervalMs: number) {
  const runtimeGlobal = globalThis as RuntimeGlobal
  if (runtimeGlobal[HEARTBEAT_TIMER_KEY]) {
    return
  }

  const timer = setInterval(() => {
    heartbeatOnce().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      warn(`heartbeat failed: ${message}`)
    })
  }, intervalMs)
  timer.unref?.()
  runtimeGlobal[HEARTBEAT_TIMER_KEY] = timer
  log('heartbeat loop started', { intervalMs })
}

export default defineNitroPlugin(async () => {
  const baseConfig = loadPlatformActivationConfig()

  if (!baseConfig.enabled) {
    if (baseConfig.appCode === 'console') {
      log('activation skipped', {
        appCode: baseConfig.appCode,
        reason: 'console keeps its native bootstrap during migration'
      })
    } else if (baseConfig.appCode) {
      log('activation skipped', {
        appCode: baseConfig.appCode,
        reason: 'business apps use Console runtime config; Platform is connected by Console only'
      })
    } else if (baseConfig.explicitEnabled) {
      warn('activation explicitly enabled but config is incomplete', { missing: baseConfig.missing })
    } else {
      log('activation skipped', {
        appCode: baseConfig.appCode || null,
        reason: 'not configured'
      })
    }
    return
  }

  let config = baseConfig
  if (baseConfig.missing.length && baseConfig.consoleApiUrl) {
    try {
      config = await resolvePlatformActivationConfig()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`activation config resolve from console failed: ${message}`)
    }
  }

  log('activation starting', {
    appCode: config.appCode,
    tenantCode: config.tenantCode || null,
    deploymentCode: config.deploymentCode || null,
    configSource: config.configSource
  })

  if (config.missing.length) {
    const message = `platform activation env missing: ${config.missing.join(', ')}`
    await patchPlatformActivationStatus(config.bundleCacheDir, {
      mode: 'failed',
      activated: false,
      envValid: false,
      licenseValid: false,
      bundleReady: false,
      tenantCode: config.tenantCode || null,
      deploymentCode: config.deploymentCode || null,
      lastCheckedAt: new Date().toISOString(),
      lastError: message
    })

    if (config.strict) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Platform activation config missing',
        message
      })
    }

    warn('activation pending because config is incomplete', { missing: config.missing })
    return
  }

  try {
    await readAndVerifyPlatformLicense(config)
    log('license verified', {
      appCode: config.appCode,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await patchPlatformActivationStatus(config.bundleCacheDir, {
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

    if (config.strict) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Platform license verification failed',
        message
      })
    }

    warn(`license verification failed: ${message}`)
    return
  }

  await patchPlatformActivationStatus(config.bundleCacheDir, {
    mode: 'pending',
    activated: false,
    envValid: true,
    licenseValid: true,
    tenantCode: config.tenantCode,
    deploymentCode: config.deploymentCode,
    lastCheckedAt: new Date().toISOString(),
    lastError: null
  })

  const cachedBundle = await readCachedPlatformBundle(config.bundleCacheDir)
  if (cachedBundle) {
    log('cached policy bundle loaded', {
      bundleVersion: cachedBundle.bundleVersion,
      bundleHash: cachedBundle.bundleHash
    })
    await patchPlatformActivationStatus(config.bundleCacheDir, {
      mode: 'active',
      activated: true,
      bundleReady: true,
      bundleVersion: cachedBundle.bundleVersion,
      bundleHash: cachedBundle.bundleHash,
      lastActivatedAt: cachedBundle.cachedAt,
      lastError: null
    })

    log('refreshing cached policy bundle from platform')
    const refreshResult = await refreshPlatformPolicyBundle('startup-refresh')
    if (refreshResult.ok) {
      log('policy bundle refreshed on startup', {
        bundleVersion: refreshResult.bundle?.bundleVersion || null,
        bundleHash: refreshResult.bundle?.bundleHash || null
      })
    } else {
      warn(`startup policy bundle refresh failed, using cached bundle: ${refreshResult.error}`)
      await postPlatformRuntimeHeartbeat(config, cachedBundle)
        .then(async () => {
          await patchPlatformActivationStatus(config.bundleCacheDir, {
            lastHeartbeatAt: new Date().toISOString()
          })
          log('startup heartbeat sent')
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          warn(`startup heartbeat failed: ${message}`)
        })
    }

    startHeartbeatLoop(config.heartbeatIntervalMs)
    return
  }

  log('no cached policy bundle, refreshing from platform')
  const result = await refreshPlatformPolicyBundle('startup')
  if (!result.ok) {
    warn(`policy bundle activation pending: ${result.error}`)
    return
  }

  log('policy bundle refreshed', {
    bundleVersion: result.bundle?.bundleVersion || null,
    bundleHash: result.bundle?.bundleHash || null
  })
  startHeartbeatLoop(config.heartbeatIntervalMs)
})
