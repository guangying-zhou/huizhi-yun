import { refreshPlatformPolicyBundle, resolvePlatformActivationConfig } from '../../utils/platformActivationRuntime'

export default defineEventHandler(async () => {
  const config = await resolvePlatformActivationConfig()

  if (!config.enabled) {
    throw createError({
      statusCode: 409,
      statusMessage: 'PLATFORM_ACTIVATION_DISABLED',
      message: 'platform activation is not enabled for this app'
    })
  }

  if (config.missing.length) {
    throw createError({
      statusCode: 500,
      statusMessage: 'PLATFORM_ACTIVATION_CONFIG_MISSING',
      message: `platform activation env missing: ${config.missing.join(', ')}`
    })
  }

  const result = await refreshPlatformPolicyBundle('manual-retry')

  return {
    code: result.ok ? 0 : 1,
    message: result.error || 'ok',
    data: {
      status: result.status,
      bundle: result.bundle
        ? {
            bundleVersion: result.bundle.bundleVersion,
            bundleHash: result.bundle.bundleHash,
            cachedAt: result.bundle.cachedAt
          }
        : null
    }
  }
})
