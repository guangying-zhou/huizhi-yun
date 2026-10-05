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
  // Shared Workers have no tenant/request context during isolate startup, and
  // workerd forbids global-scope fetch/timers. Runtime consumers load lazily
  // inside a request, where the Console Binding and trusted tenant are present.
  if (process.env.HZY_CLOUDFLARE_BUILD === 'true' || process.env.HZY_CLOUDFLARE_RUNTIME === 'true') {
    return
  }
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
