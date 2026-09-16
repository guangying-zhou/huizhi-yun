import { createError, getRequestURL, type H3Event } from 'h3'
import { resolveNotificationActionUrl } from '@hzy/foundation/shared/utils/notificationActionUrl'

type PublishBody = Record<string, unknown>

interface NotificationActionTargetDependencies {
  loadApplications: (event: H3Event) => Promise<Array<{
    appCode: string
    homeUrl?: string | null
    basePath?: string | null
    status?: string | null
  }>>
  requestOrigin: (event: H3Event) => string
}

export interface RegisteredNotificationActionTarget {
  actionUrl: string
  actionTargetAppCode: string
  sourceAppCode: string
}

/**
 * Stored with a pending projection after Console has resolved its URL against
 * the signed application catalog. It is deliberately assigned by Console,
 * never trusted from a publisher payload. The migration uses it to identify
 * historical projections for which that proof does not exist.
 */
export const NOTIFICATION_ACTION_TARGET_CATALOG_BINDING = 'catalog-v1'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown) {
  return String(value || '').trim()
}

function normalizedAppCode(value: unknown) {
  return text(value).toLowerCase()
}

function hasPendingActionableState(metadata: Record<string, unknown>) {
  return normalizedAppCode(metadata.actionableState) === 'pending'
}

function controlledActionTargetAppCode(metadata: Record<string, unknown>) {
  const explicit = normalizedAppCode(metadata.actionTargetAppCode)
  const target = normalizedAppCode(metadata.targetAppCode)
  if (explicit && target && explicit !== target) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_action_target',
      message: 'Notification action target application identities do not match'
    })
  }
  return explicit || target
}

async function loadConsoleApplications(event: H3Event) {
  const { getConsoleApplicationCatalog } = await import('./userApplications.js')
  return await getConsoleApplicationCatalog(event)
}

export async function resolveRegisteredNotificationActionTarget(
  event: H3Event,
  detail: RegisteredNotificationActionTarget,
  dependencies: NotificationActionTargetDependencies = {
    loadApplications: loadConsoleApplications,
    requestOrigin: requestEvent => getRequestURL(requestEvent).origin
  }
) {
  let applications: Awaited<ReturnType<NotificationActionTargetDependencies['loadApplications']>>
  try {
    applications = await dependencies.loadApplications(event)
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'action_target_catalog_unavailable',
      message: 'Signed application route catalog is unavailable'
    })
  }
  const actionUrl = resolveNotificationActionUrl(detail, applications, dependencies.requestOrigin(event))
  if (!actionUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_action_target',
      message: 'Notification action URL does not match its registered target application'
    })
  }
  return actionUrl
}

export async function bindPendingNotificationActionTarget(
  event: H3Event,
  body: PublishBody,
  sourceAppCode: string,
  dependencies: NotificationActionTargetDependencies = {
    loadApplications: loadConsoleApplications,
    requestOrigin: requestEvent => getRequestURL(requestEvent).origin
  }
) {
  const source = normalizedAppCode(sourceAppCode)

  const metadata = record(body.metadata)
  // Workflow has always had a catalog-bound action URL. Preserve that
  // compatibility while expanding the same guarantee to every explicit
  // pending actionable publisher. Ordinary non-Workflow notifications and
  // terminal lifecycle publications deliberately remain untouched.
  if (source !== 'workflow' && !hasPendingActionableState(metadata)) return body

  const actionTargetAppCode = controlledActionTargetAppCode(metadata)
  if (!actionTargetAppCode) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_action_target', message: 'Pending actionable notification requires an action target app' })
  }

  const actionUrl = await resolveRegisteredNotificationActionTarget(event, {
    actionUrl: text(body.actionUrl),
    actionTargetAppCode,
    sourceAppCode: source
  }, dependencies)

  return {
    ...body,
    actionUrl,
    metadata: {
      ...metadata,
      // Both aliases describe one Console-controlled identity. Persist both
      // so the projection and detail contracts cannot disagree.
      targetAppCode: actionTargetAppCode,
      actionTargetAppCode,
      actionTargetCatalogBinding: NOTIFICATION_ACTION_TARGET_CATALOG_BINDING
    }
  }
}

/** @deprecated Use bindPendingNotificationActionTarget. */
export const bindWorkflowNotificationActionTarget = bindPendingNotificationActionTarget
