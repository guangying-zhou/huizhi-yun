import { createError, type H3Event } from 'h3'
import { loadConsoleRuntimeMode, resolveManagedCloudTenantContext } from './platformRuntime'

export interface ConsoleRuntimeBinding {
  tenantId: string
  deploymentId: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export function resolveConsoleRuntimeBinding(event: H3Event): ConsoleRuntimeBinding {
  const mode = loadConsoleRuntimeMode(event)
  if (mode.activationMode === 'managed-cloud-multitenant') {
    const managed = resolveManagedCloudTenantContext(event)
    if (managed?.tenantCode && managed.deploymentCode) {
      return { tenantId: managed.tenantCode, deploymentId: managed.deploymentCode }
    }
    throw createError({ statusCode: 503, message: 'console_runtime_binding_unavailable' })
  }

  const config = useRuntimeConfig(event) as unknown as {
    platform?: { tenantCode?: unknown, deploymentCode?: unknown }
  }
  const tenantId = stringValue(config.platform?.tenantCode)
  const deploymentId = stringValue(config.platform?.deploymentCode)
  if (!tenantId || !deploymentId) {
    throw createError({ statusCode: 503, message: 'console_runtime_binding_unavailable' })
  }
  return { tenantId, deploymentId }
}
