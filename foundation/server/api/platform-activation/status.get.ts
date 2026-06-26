import { loadPlatformActivationStatus, resolvePlatformActivationConfig } from '../../utils/platformActivationRuntime'

export default defineEventHandler(async () => {
  const config = await resolvePlatformActivationConfig()
  const status = await loadPlatformActivationStatus()

  return {
    code: 0,
    data: {
      enabled: config.enabled,
      appCode: config.appCode || null,
      tenantCode: config.tenantCode || null,
      deploymentCode: config.deploymentCode || null,
      configSource: config.configSource,
      missing: config.missing,
      status
    }
  }
})
