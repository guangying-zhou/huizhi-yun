import type { H3Event } from 'h3'
import { getCachedBundleInvalidReason, readCachedBundle } from './bundleCache'
import {
  fetchPlatformPolicyRevision,
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope
} from './platformRuntime'
import { evaluateWithRevisionCheckedServicePolicy } from './revisionCheckedServicePolicyCore'

// Only the two service authorization reads use this revision gate. Notification
// details retain their separately defined fresh-policy behavior.
export async function evaluateWithRevisionCheckedConsoleServicePolicy<T>(event: H3Event, tenant: string, evaluate: () => Promise<T>) {
  const mode = loadConsoleRuntimeMode(event)
  if (mode.activationMode !== 'managed-cloud-multitenant') return evaluate()
  const config = loadPlatformRuntimeConfig(event)
  const scope = resolvePlatformRuntimeCacheScope(config, event)
  return evaluateWithRevisionCheckedServicePolicy({
    managed: true,
    tenant,
    deployment: config.deploymentCode,
    maxSignedAgeMs: process.env.HZY_CONSOLE_SERVICE_POLICY_MAX_AGE_MS === undefined
      ? undefined
      : Number(process.env.HZY_CONSOLE_SERVICE_POLICY_MAX_AGE_MS),
    evaluate,
    read: async () => {
      const bundle = await readCachedBundle(config.bundleCacheDir, scope, event)
      return getCachedBundleInvalidReason(bundle) ? null : bundle
    },
    probe: () => fetchPlatformPolicyRevision(event),
    refresh: async () => {
      const result = await refreshPlatformBundle('service-authorization-revision-change', event)
      return { ok: result.ok, bundle: getCachedBundleInvalidReason(result.bundle) ? null : result.bundle }
    }
  })
}
