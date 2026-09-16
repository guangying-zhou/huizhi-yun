import type { H3Event } from 'h3'
import {
  resolveNotificationActionUrl,
  type NotificationActionTarget,
  type NotificationActionTargetCatalog
} from '../../shared/utils/notificationActionUrl.js'
import { getConsoleRuntimeConfig } from './consoleRuntime.js'
import { resolveHzyDevApplications } from './devApplications.js'
import { loadHzyLocalDevRuntimeMode } from './localDevRuntime.js'

export async function loadNotificationActionTargetCatalog(event: H3Event): Promise<NotificationActionTargetCatalog | null> {
  try {
    const runtime = await getConsoleRuntimeConfig({ event, allowFallback: false })
    const applications = (runtime.applications || []).filter(app => (
      String(app.status || '').trim().toLowerCase() === 'active' || !String(app.status || '').trim()
    ))
    if (runtime.bundle?.bundleHash && applications.length > 0) {
      return {
        applications,
        currentOrigin: runtime.console.baseUrl,
        source: 'policy_bundle'
      }
    }
  } catch {
    // Local development is the only permitted non-bundle fallback.
  }

  const localDev = loadHzyLocalDevRuntimeMode(event)
  if (!localDev.devApplicationsEnabled) return null
  const applications = resolveHzyDevApplications()
  return applications.length > 0
    ? { applications, currentOrigin: 'http://localhost', source: 'local_dev' }
    : null
}

export function resolveServerNotificationActionUrl(
  detail: NotificationActionTarget,
  catalog: NotificationActionTargetCatalog
) {
  return resolveNotificationActionUrl(detail, catalog.applications, catalog.currentOrigin)
}
