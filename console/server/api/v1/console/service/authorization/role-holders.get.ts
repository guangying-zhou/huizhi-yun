import { createError, setHeader } from 'h3'
import {
  getCachedBundleInvalidReason,
  readActivationStatus,
  readCachedBundle
} from '~~/server/utils/bundleCache'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { evaluateWithFreshNotificationDetailPolicy } from '~~/server/utils/notificationDetailFreshPolicy'
import {
  loadPlatformRuntimeConfig,
  resolvePlatformRuntimeCacheScope
} from '~~/server/utils/platformRuntime'
import {
  buildRoleHolderProjection,
  normalizeRequestedRoleCodes
} from '~~/server/utils/roleHolders'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(
    event,
    'console',
    'console:authorization-role-holders:read',
    { requireBoundTargetApp: true }
  )
  const roleCodes = normalizeRequestedRoleCodes(getQuery(event).roleCodes)
  const binding = resolveConsoleRuntimeBinding(event)
  setHeader(event, 'Cache-Control', 'no-store')

  try {
    return await evaluateWithFreshNotificationDetailPolicy(event, binding, async () => {
      const config = loadPlatformRuntimeConfig(event)
      const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
      const [activation, bundle] = await Promise.all([
        readActivationStatus(config.bundleCacheDir, cacheScope),
        readCachedBundle(config.bundleCacheDir, cacheScope)
      ])
      const invalidReason = getCachedBundleInvalidReason(bundle)
      if (
        invalidReason
        || !bundle
        || !activation.activated
        || !activation.bundleReady
        || bundle.tenantCode !== binding.tenantId
        || (
          config.activationMode !== 'managed-cloud-multitenant'
          && bundle.deploymentCode !== binding.deploymentId
        )
      ) {
        throw createError({
          statusCode: 503,
          message: 'authorization_role_holders_policy_unavailable'
        })
      }

      const roles = buildRoleHolderProjection(bundle.payload, roleCodes)
      return {
        code: 0,
        data: {
          tenantCode: binding.tenantId,
          deploymentCode: binding.deploymentId,
          healthy: roles.every(role => role.status === 'resolved'),
          roles
        }
      }
    })
  } catch (error) {
    if (Number((error as { statusCode?: unknown })?.statusCode || 0) > 0) {
      throw error
    }
    throw createError({
      statusCode: 503,
      message: 'authorization_role_holders_policy_unavailable'
    })
  }
})
