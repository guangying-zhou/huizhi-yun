import {
  getConsoleRuntimeConfig,
  resolveConsoleRuntimeSeedConfig
} from '../utils/consoleRuntime'

function log(message: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[foundation.console-runtime] ${message}`, detail)
    return
  }
  console.info(`[foundation.console-runtime] ${message}`)
}

function warn(message: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.warn(`[foundation.console-runtime] ${message}`, detail)
    return
  }
  console.warn(`[foundation.console-runtime] ${message}`)
}

export default defineNitroPlugin(async () => {
  const seed = resolveConsoleRuntimeSeedConfig()

  if (!seed.enabled) {
    log('runtime fetch skipped', {
      appCode: seed.appCode || null,
      reason: 'disabled for this app'
    })
    return
  }

  if (!seed.appCode || !seed.consoleApiUrl) {
    warn('runtime fetch skipped because config is incomplete', {
      appCode: seed.appCode || null,
      consoleApiUrl: seed.consoleApiUrl || null
    })
    return
  }

  try {
    const runtime = await getConsoleRuntimeConfig({ forceRefresh: true, allowFallback: false })
    log('runtime config loaded', {
      appCode: runtime.app.appCode,
      consoleUrl: runtime.console.baseUrl,
      bundleVersion: runtime.bundle?.bundleVersion || null
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warn(`runtime config load failed: ${message}`)
  }
})
