import { createError, getHeader, type H3Event } from 'h3'
import {
  advanceConsoleNotificationActionableLifecycle,
  getConsoleUserNotificationTodos,
  getConsoleUserNotificationTodoSummary,
  publishConsoleCanonicalNotification,
  recordConsoleNotificationDelivery
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { verifyAccessToken } from '~~/server/utils/oidc'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'
import {
  canonicalizePortalNotificationRequest,
  PortalNotificationPublishError,
  type PublishPortalNotificationInput
} from './portalNotificationIdempotency'
import {
  PortalActionableProjectionError,
  validatePortalActionableLifecycleInput,
  type AdvancePortalActionableLifecycleInput
} from './portalActionableProjection'
import type { PendingActionableListInput } from './portalActionableList'
import { callConsoleTenantRuntimeTask } from './consoleTenantRuntimeTaskClient'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type NotificationStatusFilter = 'all' | 'unread' | 'read' | 'archived'
export type NotificationDeliveryStatus = 'pending' | 'success' | 'failed' | 'skipped'

function text(value: unknown) {
  return String(value || '').trim()
}

function bearerToken(value: unknown) {
  const match = text(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function uidFromPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>) {
  return text((payload.hzy as { uid?: unknown } | undefined)?.uid)
    || text(payload.sub).replace(/^user:/, '')
}

function bindVerifiedNotificationUser(event: H3Event, uid: string, token?: string) {
  const existing = event.context.consoleAuth as Record<string, unknown> | undefined
  event.context.consoleAuth = {
    ...(existing || {}),
    authenticated: true,
    subjectType: 'user',
    uid,
    subjectCode: uid,
    ...(token ? { token, tokenUse: 'access' } : {})
  }
}

function runtimeError(error: unknown): never {
  if (error instanceof PortalNotificationPublishError || error instanceof PortalActionableProjectionError) {
    throw createError({ statusCode: error.statusCode, message: error.message, data: { error: error.code } })
  }
  throw error
}

export async function requireNotificationUserUid(event: H3Event) {
  const authContext = event.context?.consoleAuth as {
    authenticated?: boolean
    subjectType?: string
    uid?: string | null
    token?: string | null
    tokenUse?: string | null
  } | undefined

  if (authContext?.authenticated && authContext.subjectType !== 'service') {
    const uid = text(authContext.uid)
    if (uid) return uid
  }

  const contextToken = authContext?.tokenUse !== 'service' && authContext?.subjectType !== 'service'
    ? text(authContext?.token)
    : ''
  const token = bearerToken(getHeader(event, 'authorization')) || contextToken
  if (token) {
    const payload = await verifyAccessToken(event, token)
    const uid = uidFromPayload(payload)
    if (uid) {
      // The Runtime client signs its user delegation from consoleAuth. Direct
      // business-app notification requests verify their access token here, so
      // persist that verified identity before calling the tenant Runtime.
      bindVerifiedNotificationUser(event, uid, token)
      return uid
    }
  }

  const session = await resolveOptionalConsoleSession(event, { allowLegacyFallback: false })
  if (session?.uid) {
    bindVerifiedNotificationUser(event, session.uid)
    return session.uid
  }

  throw createError({ statusCode: 401, message: 'Console login required' })
}

export async function getUserTodoSummary(event: H3Event) {
  const response = await getConsoleUserNotificationTodoSummary(event)
  return response.data
}

export async function listUserPendingActionables(
  event: H3Event,
  input: Omit<PendingActionableListInput, 'uid'>
) {
  const response = await getConsoleUserNotificationTodos(event, input as Record<string, unknown>)
  return response.data
}

export async function publishPortalNotification(
  input: PublishPortalNotificationInput,
  actor: { actorId?: string | null, appCode?: string | null },
  event?: H3Event
) {
  try {
    const request = canonicalizePortalNotificationRequest(input, actor)
    const body = request as unknown as Record<string, unknown>
    const response = event
      ? await publishConsoleCanonicalNotification(event, body)
      : await callConsoleTenantRuntimeTask<{ data: {
          notificationId: string
          sourceAppCode: string
          recipients: string[]
          channels: string[]
          replayed: boolean
        } }>('/v1/console/notifications/publish-canonical', { method: 'POST', body })
    return response.data
  } catch (error) {
    return runtimeError(error)
  }
}

export async function advancePortalActionableLifecycleForService(
  input: AdvancePortalActionableLifecycleInput,
  actor: { appCode?: string | null },
  event?: H3Event
) {
  try {
    const request = validatePortalActionableLifecycleInput(input, actor)
    const body = request as unknown as Record<string, unknown>
    const response = event
      ? await advanceConsoleNotificationActionableLifecycle(event, body)
      : await callConsoleTenantRuntimeTask<{ data: Record<string, unknown> }>(
          '/v1/console/notifications/actionable-lifecycle',
          { method: 'POST', body }
        )
    return response.data
  } catch (error) {
    return runtimeError(error)
  }
}

export async function recordPortalNotificationDelivery(
  input: Record<string, unknown>,
  event?: H3Event
) {
  const response = event
    ? await recordConsoleNotificationDelivery(event, input)
    : await callConsoleTenantRuntimeTask<{ data: Record<string, unknown> }>(
        '/v1/console/notifications/deliveries',
        { method: 'POST', body: input }
      )
  return response.data
}
