import type { CollabConfig } from 'collab'
import {
  getConsoleCollabRuntimeState,
  setConsoleCollabRuntimeState,
  type ConsoleCollabMode
} from '~~/server/utils/collabRuntime'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function boolValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function resolveMode(): ConsoleCollabMode {
  const config = useRuntimeConfig()
  const consoleRuntime = (config.consoleRuntime || {}) as Record<string, unknown>
  const value = stringValue(
    process.env.CONSOLE_COLLAB_MODE
    || process.env.HZY_COLLAB_MODE
    || process.env.COLLAB_RUNTIME_MODE
    || consoleRuntime.collabMode
  ).toLowerCase()

  if (value === 'disabled' || value === 'false' || value === 'off') return 'disabled'
  if (value === 'external' || value === 'standalone') return 'external'

  const isCloudflareRuntime = boolValue(
    process.env.HZY_CLOUDFLARE_RUNTIME
    || process.env.HZY_CLOUDFLARE_BUILD
    || consoleRuntime.cloudflareRuntime,
    false
  )
  const runMode = stringValue(
    process.env.HZY_CONSOLE_RUN_MODE
    || process.env.CONSOLE_RUN_MODE
    || consoleRuntime.runMode
  ).toLowerCase()

  if (isCloudflareRuntime || runMode === 'dev') return 'disabled'
  return 'embedded'
}

function persistenceStatus(config: CollabConfig) {
  return {
    ossConfigured: Boolean(config.oss.accessKeyId && config.oss.accessKeySecret && config.oss.bucketName && config.oss.endpoint),
    integrationCode: config.oss.integrationCode,
    defaultBucket: config.oss.bucketName || undefined,
    projectsBucket: config.oss.projectsBucketName || config.oss.bucketName || undefined,
    imagesBucket: config.oss.imagesBucketName || config.oss.bucketName || undefined
  }
}

export default defineNitroPlugin(async (nitroApp) => {
  const mode = resolveMode()

  if (mode === 'disabled') {
    setConsoleCollabRuntimeState({
      mode,
      status: 'disabled'
    })
    console.log('[console:collab] runtime disabled by CONSOLE_COLLAB_MODE')
    return
  }

  if (mode === 'external') {
    setConsoleCollabRuntimeState({
      mode,
      status: 'external'
    })
    console.log('[console:collab] runtime uses external collab service')
    return
  }

  const [
    { loadCollabConfig, startCollabRuntime },
    { resolveConsoleOssRuntimeConfig }
  ] = await Promise.all([
    import('collab'),
    import('~~/server/utils/ossRuntime')
  ])

  const config = loadCollabConfig({
    runtimeMode: 'embedded',
    stopOnSignals: false
  })

  try {
    config.oss = await resolveConsoleOssRuntimeConfig({
      integrationCode: stringValue(
        process.env.CONSOLE_COLLAB_OSS_INTEGRATION_CODE
        || process.env.COLLAB_OSS_INTEGRATION_CODE
        || process.env.HZY_OSS_INTEGRATION_CODE
      ) || config.oss.integrationCode || 'oss.default',
      actorId: 'console:collab-runtime',
      purpose: 'collab_runtime_persistence'
    })
    console.log(`[console:collab] loaded OSS integration ${config.oss.integrationCode}`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[console:collab] OSS integration unavailable, falling back to Collab env config: ${message}`)
  }

  setConsoleCollabRuntimeState({
    mode,
    status: 'starting',
    runtimeStatus: {
      appCode: config.appCode,
      provider: config.provider,
      runtimeMode: config.runtimeMode,
      port: config.port,
      address: config.address,
      basePath: config.basePath,
      startedAt: new Date().toISOString(),
      codocsRuntime: {
        endpointConfigured: Boolean(config.codocsRuntime.endpoint),
        endpoint: config.codocsRuntime.endpoint || undefined
      },
      redisStatus: 'starting',
      persistence: persistenceStatus(config)
    }
  })

  try {
    const runtime = await startCollabRuntime({
      config
    })

    setConsoleCollabRuntimeState({
      mode,
      status: 'running',
      runtime
    })

    nitroApp.hooks.hook('close', async () => {
      const state = getConsoleCollabRuntimeState()
      if (!state.runtime) return

      await state.runtime.stop()
      setConsoleCollabRuntimeState({
        mode,
        status: 'stopped',
        runtimeStatus: state.runtime.getStatus()
      })
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)

    setConsoleCollabRuntimeState({
      mode,
      status: 'failed',
      runtimeStatus: config
        ? {
            appCode: config.appCode,
            provider: config.provider,
            runtimeMode: config.runtimeMode,
            port: config.port,
            address: config.address,
            basePath: config.basePath,
            startedAt: new Date().toISOString(),
            codocsRuntime: {
              endpointConfigured: Boolean(config.codocsRuntime.endpoint),
              endpoint: config.codocsRuntime.endpoint || undefined
            },
            redisStatus: 'failed',
            persistence: persistenceStatus(config)
          }
        : undefined,
      error: message
    })

    console.error(`[console:collab] failed to start embedded runtime: ${message}`)

    if (boolValue(process.env.CONSOLE_COLLAB_REQUIRED, false)) {
      throw error
    }
  }
})
