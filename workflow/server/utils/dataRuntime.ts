import type { H3Event } from 'h3'
import { $fetch } from 'ofetch'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { publishNotification } from '@hzy/foundation/server/utils/notifications'

interface RuntimeNotification {
  touser?: string[] | string
  title?: string
  description?: string
  url?: string
}

interface RuntimeCallback {
  url?: string
  payload?: {
    app_code?: string
    event?: string
    [key: string]: unknown
  }
}

interface WorkflowRuntimeEffects {
  notifications?: RuntimeNotification[]
  callbacks?: RuntimeCallback[]
}

export interface WorkflowRuntimeEnvelope<T = unknown> {
  code: number
  data: T
  effects?: WorkflowRuntimeEffects
}

export function maybeCallWorkflowDataRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    scope: string
    method?: string
    body?: unknown
    query?: Record<string, unknown>
  }
) {
  return maybeCallTenantRuntime<T>(event, path, {
    appCode: 'workflow',
    scope: options.scope,
    method: options.method,
    body: options.body,
    query: options.query
  })
}

export async function runWorkflowRuntimeEffects(event: H3Event, effects?: WorkflowRuntimeEffects) {
  await sendWorkflowRuntimeNotifications(event, effects?.notifications)
  await sendRuntimeCallbacks(effects?.callbacks)
}

function notificationUsers(notification: RuntimeNotification) {
  return Array.isArray(notification.touser)
    ? notification.touser.map(item => String(item || '').trim()).filter(Boolean)
    : String(notification.touser || '').trim()
}

function notificationIdempotencyKey(notification: RuntimeNotification, users: string[] | string) {
  return [
    'workflow',
    String(notification.title || '').trim(),
    String(notification.url || '').trim(),
    Array.isArray(users) ? users.join('|') : users
  ].join(':')
}

export async function sendWorkflowRuntimeNotifications(event: H3Event, notifications: RuntimeNotification[] = []) {
  for (const notification of notifications) {
    const users = notificationUsers(notification)

    if (Array.isArray(users) ? users.length === 0 : !users) continue
    const title = notification.title || '您有新的审批待办'
    const description = notification.description || ''
    const url = notification.url || ''

    try {
      await publishNotification({
        event,
        sourceAppCode: 'workflow',
        eventType: 'workflow.notification',
        category: 'approval',
        severity: 'info',
        title,
        summary: description,
        actionUrl: url,
        bizType: 'workflow',
        bizId: url || title,
        idempotencyKey: notificationIdempotencyKey(notification, users),
        recipients: users,
        channels: ['in_app']
      })
    } catch (error) {
      console.error('[WorkflowRuntime] 发布站内通知失败:', error)
    }

    if (!url) continue

    try {
      await sendNotification({
        touser: users,
        title,
        description,
        url,
        event
      })
    } catch (error) {
      console.error('[WorkflowRuntime] 发送通知失败:', error)
    }
  }
}

async function sendRuntimeCallbacks(callbacks: RuntimeCallback[] = []) {
  for (const callback of callbacks) {
    const url = String(callback.url || '').trim()
    const payload = callback.payload
    if (!url || !payload) continue

    try {
      const accessToken = await requestServiceAccessToken({
        audience: String(payload.app_code || 'workflow'),
        scope: 'workflow:callback'
      })

      await $fetch(url, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${accessToken}`,
          'content-type': 'application/json',
          ...(payload.event ? { 'x-workflow-event': String(payload.event) } : {})
        },
        body: payload,
        timeout: 10000
      })
    } catch (error) {
      console.error('[WorkflowRuntime] 回调失败:', error)
    }
  }
}
