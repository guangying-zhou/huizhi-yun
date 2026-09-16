import type { H3Event } from 'h3'
import {
  loadConsoleRuntimeMode,
  refreshPlatformBundle,
  type ConsoleRuntimeModeConfig,
  type RefreshBundleResult
} from './platformRuntime'
import { evaluateWithManagedFreshNotificationDetailPolicy } from './notificationDetailFreshPolicyCore'

interface RuntimeBinding {
  tenantId: string
  deploymentId: string
}

interface FreshPolicyDependencies {
  loadMode?: (event: H3Event) => ConsoleRuntimeModeConfig
  refresh?: (reason: string, event: H3Event) => Promise<RefreshBundleResult>
}

export async function evaluateWithFreshNotificationDetailPolicy<T>(
  event: H3Event,
  binding: RuntimeBinding,
  evaluate: () => Promise<T>,
  dependencies: FreshPolicyDependencies = {}
) {
  const mode = (dependencies.loadMode || loadConsoleRuntimeMode)(event)
  return await evaluateWithManagedFreshNotificationDetailPolicy(
    mode.activationMode === 'managed-cloud-multitenant',
    binding,
    evaluate,
    async () => await (dependencies.refresh || refreshPlatformBundle)(
      'notification-detail-authorization',
      event
    )
  )
}
