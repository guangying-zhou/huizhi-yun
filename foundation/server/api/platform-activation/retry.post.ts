import { createError, type H3Event } from 'h3'
import {
  loadPlatformActivationStatus,
  refreshPlatformPolicyBundle,
  resolvePlatformActivationConfig
} from '../../utils/platformActivationRuntime'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '../../utils/platformBundleAuthorization'

type ConsoleAuthContext = {
  authenticated?: boolean
  uid?: string | null
  subjectType?: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

async function requireActivatedPlatformRetryPermission(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  const uid = consoleAuth?.authenticated && consoleAuth.subjectType !== 'service'
    ? stringValue(consoleAuth.uid)
    : ''
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, 'console', event)
  const actions = snapshot.resources.system_settings || []
  if (!actions.includes('admin')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '需要系统运行时管理权限'
    })
  }
}

export default defineEventHandler(async (event) => {
  const config = await resolvePlatformActivationConfig()
  const status = await loadPlatformActivationStatus()

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

  if (status.activated) {
    await requireActivatedPlatformRetryPermission(event)
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
