import type { H3Event } from 'h3'
import { getCachedBundleInvalidReason, readCachedBundle, verifiedPolicyStoreEnabled } from './bundleCache'
import {
  fetchPlatformPolicyRevision,
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope
} from './platformRuntime'
import { evaluateWithRevisionCheckedServicePolicy, servicePolicyBinding } from './revisionCheckedServicePolicyCore'
import { verifiedPolicyTrust } from './verifiedPolicyRuntime'

// Only the two service authorization reads use this revision gate. Notification
// details retain their separately defined fresh-policy behavior.
export async function evaluateWithRevisionCheckedConsoleServicePolicy<T>(event: H3Event, tenant: string, evaluate: () => Promise<T>) {
  const mode = loadConsoleRuntimeMode(event)
  if (mode.activationMode !== 'managed-cloud-multitenant') return evaluate()
  const config = loadPlatformRuntimeConfig(event)
  const scope = resolvePlatformRuntimeCacheScope(config, event)
  const verifiedStore = verifiedPolicyStoreEnabled(event)
  const binding = servicePolicyBinding({
    verifiedStore,
    callerDeployment: config.deploymentCode,
    ownerDeployment: verifiedStore ? verifiedPolicyTrust(config, event).context.deployment : config.deploymentCode
  })
  return evaluateWithRevisionCheckedServicePolicy({
    managed: true,
    tenant,
    deployment: binding.deployment,
    maxSignedAgeMs: process.env.HZY_CONSOLE_SERVICE_POLICY_MAX_AGE_MS === undefined
      ? undefined
      : Number(process.env.HZY_CONSOLE_SERVICE_POLICY_MAX_AGE_MS),
    evaluate,
    read: async () => {
      const bundle = await readCachedBundle(config.bundleCacheDir, scope, event)
      return getCachedBundleInvalidReason(bundle) ? null : bundle
    },
    probe: () => fetchPlatformPolicyRevision(event, { deploymentCode: binding.deployment }),
    refresh: async () => {
      if (!binding.refreshOnRequest) return { ok: false, bundle: null }
      const result = await refreshPlatformBundle('service-authorization-revision-change', event)
      return { ok: result.ok, bundle: getCachedBundleInvalidReason(result.bundle) ? null : result.bundle }
    }
  })
}
