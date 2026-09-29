import {
  ENTERPRISE_HOST_NOTIFICATION_TARGET,
  type NotificationHostTarget
} from '../../shared/utils/notificationActionUrl.js'
import { ENTERPRISE_SHARED_API_BASE, resolveSharedApiBase } from '../../shared/utils/sharedApiPath.js'

export {
  resolveNotificationActionUrl as resolveAppNotificationActionUrl,
  type NotificationActionTarget,
  type NotificationTargetApplication
} from '../../shared/utils/notificationActionUrl.js'

/**
 * Host-native notification target context, returned only when this browser
 * app is the composed Enterprise Host (the same strict build-time check as
 * `sharedApiPath`). Standalone applications and Console get null and keep the
 * catalog-only resolution. Pass a public config explicitly in tests; without
 * one the current Nuxt app's public config is read.
 */
export function hostNotificationTarget(publicConfig?: Record<string, unknown> | null): NotificationHostTarget | null {
  const config = publicConfig !== undefined
    ? publicConfig
    : (typeof tryUseNuxtApp === 'function' ? tryUseNuxtApp()?.$config?.public as Record<string, unknown> | undefined : undefined)
  return resolveSharedApiBase(config) === ENTERPRISE_SHARED_API_BASE ? ENTERPRISE_HOST_NOTIFICATION_TARGET : null
}
