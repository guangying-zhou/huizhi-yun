import type { H3Event } from 'h3'
import { $fetch } from 'ofetch'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { tenantGatewayServiceBinding } from '@hzy/foundation/server/utils/cloudflareServiceBinding'
import { loadNotificationActionTargetCatalog } from '@hzy/foundation/server/utils/notificationActionTarget'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'
import {
  deliverWorkflowRuntimeNotifications,
  type RuntimeNotification,
  type WorkflowNotificationDependencies
} from './runtimeNotifications'
import {
  deliverWorkflowActionableLifecyclesWithDependencies,
  type ActionableLifecycleDependencies,
  type RuntimeActionableLifecycle
} from './runtimeActionableLifecycles'

interface RuntimeCallback {
  effectId?: number
  url?: string
  payload?: {
    app_code?: string
    event?: string
    [key: string]: unknown
  }
}

interface WorkflowRuntimeEffects {
  notifications?: RuntimeNotification[]
  actionableLifecycles?: RuntimeActionableLifecycle[]
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
    serviceTokenSourceBinding?: 'trusted-gateway' | 'service-client-policy'
    serviceCommandActor?: { uid: string }
    workflowProxyActor?: { uid: string }
  }
) {
  return maybeCallTenantRuntime<T>(event, path, {
    appCode: 'workflow',
    scope: options.scope,
    method: options.method,
    body: options.body,
    query: options.query,
    serviceTokenSourceBinding: options.serviceTokenSourceBinding,
    serviceCommandActor: options.serviceCommandActor,
    workflowProxyActor: options.workflowProxyActor
  })
}

export async function runWorkflowRuntimeEffects(event: H3Event, effects?: WorkflowRuntimeEffects) {
  const notifications = await sendWorkflowRuntimeNotifications(event, effects?.notifications)
  const canAdvanceLifecycle = notifications.every(result => result.status === 'published')
  const actionableLifecycles = canAdvanceLifecycle
    ? await deliverWorkflowActionableLifecycles(event, effects?.actionableLifecycles, undefined, false)
    : (effects?.actionableLifecycles || []).map(effect => ({
        effect,
        status: 'pending' as const,
        code: 'notification_publish_incomplete'
      }))
  const callbacks = await sendRuntimeCallbacks(event, effects?.callbacks)
  return { notifications, actionableLifecycles, callbacks, notificationBarrierPassed: canAdvanceLifecycle }
}

export async function sendWorkflowRuntimeNotifications(
  event: H3Event,
  notifications: RuntimeNotification[] = [],
  dependencies: WorkflowNotificationDependencies = {
    send: sendNotification,
    error: (message, error) => console.error(message, error),
    loadActionTargetCatalog: loadNotificationActionTargetCatalog,
    checkEligibility: checkSubjectEligibility
  }
) {
  return await deliverWorkflowRuntimeNotifications(event, notifications, dependencies)
}

export async function deliverWorkflowActionableLifecycles(
  event: H3Event,
  lifecycles: RuntimeActionableLifecycle[] = [],
  dependencies: ActionableLifecycleDependencies = {
    requestAccessToken: requestServiceAccessToken,
    request: (url, options) => $fetch(url, options),
    resolveConsoleBaseUrl: runtimeEvent => resolveServiceAppBaseUrl(runtimeEvent, 'console'),
    checkpoint: checkpointWorkflowActionableLifecycle,
    publishNotifications: sendWorkflowRuntimeNotifications,
    error: (message, error) => console.error(message, error)
  },
  publishPrerequisites = true
) {
  return await deliverWorkflowActionableLifecyclesWithDependencies(event, lifecycles, dependencies, publishPrerequisites)
}

async function checkpointWorkflowActionableLifecycle(event: H3Event, effectId: number, outcome: 'ack' | 'fail') {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(
    event,
    `/v1/workflow/actionable-lifecycle-effects/${effectId}/${outcome}`,
    { scope: 'workflow.write', method: 'POST', body: {} }
  )
  if (!runtime.handled || runtime.data.code !== 0) {
    throw new Error(`workflow_actionable_lifecycle_${outcome}_failed`)
  }
  return runtime.data.data
}

export async function drainWorkflowActionableLifecycleOutbox(event: H3Event) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<RuntimeActionableLifecycle[]>>(
    event,
    '/v1/workflow/actionable-lifecycle-effects/pending',
    { scope: 'workflow.read', method: 'GET', query: { limit: 100 } }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !Array.isArray(runtime.data.data)) return []
  return await deliverWorkflowActionableLifecycles(event, runtime.data.data)
}

async function sendRuntimeCallbacks(event: H3Event, callbacks: RuntimeCallback[] = []) {
  const results: Array<{ callback: RuntimeCallback, status: 'delivered' | 'failed', error?: string }> = []
  for (const callback of callbacks) {
    const url = String(callback.url || '').trim()
    const payload = callback.payload
    const appCode = String(payload?.app_code || '').trim()
    if (!url || !payload || !appCode || !url.startsWith('/') || url.startsWith('//')) {
      results.push({ callback, status: 'failed', error: 'invalid_callback_target' })
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, 'fail', 'invalid_callback_target')
      continue
    }

    const baseUrl = resolveServiceAppBaseUrl(event, appCode)
    if (!baseUrl) {
      results.push({ callback, status: 'failed', error: 'callback_app_url_unavailable' })
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, 'fail', 'callback_app_url_unavailable')
      continue
    }
    const callbackUrl = `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`

    try {
      const accessToken = await requestServiceAccessToken({
        audience: appCode,
        scope: 'workflow:callback',
        event
      })

      const headers = {
        'authorization': `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(payload.event ? { 'x-workflow-event': String(payload.event) } : {})
      }
      const gatewayBinding = tenantGatewayServiceBinding(event)
      if (gatewayBinding) {
        const response = await gatewayBinding.fetch(callbackUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(10000) : undefined
        })
        if (!response.ok) {
          const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>
          throw new Error(String(responseBody.message || response.statusText || `workflow_callback_http_${response.status}`))
        }
      } else {
        await $fetch(callbackUrl, {
          method: 'POST',
          headers,
          body: payload,
          timeout: 10000
        })
      }
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, 'ack')
      results.push({ callback, status: 'delivered' })
    } catch (error) {
      console.error('[WorkflowRuntime] 回调失败:', error)
      const message = error instanceof Error ? error.message : String(error)
      if (callback.effectId) {
        await checkpointWorkflowCallback(event, callback.effectId, 'fail', message).catch((checkpointError) => {
          console.error('[WorkflowRuntime] 回调失败状态写回失败:', checkpointError)
        })
      }
      results.push({ callback, status: 'failed', error: message })
    }
  }
  return results
}

async function checkpointWorkflowCallback(
  event: H3Event,
  effectId: number,
  outcome: 'ack' | 'fail',
  error?: string
) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(
    event,
    `/v1/workflow/callback-effects/${effectId}/${outcome}`,
    {
      scope: 'workflow.write',
      method: 'POST',
      body: outcome === 'fail' ? { error: String(error || 'callback_delivery_failed') } : {}
    }
  )
  if (!runtime.handled || runtime.data.code !== 0) {
    throw new Error(`workflow_callback_${outcome}_failed`)
  }
}

export async function drainWorkflowCallbackOutbox(event: H3Event) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<RuntimeCallback[]>>(
    event,
    '/v1/workflow/callback-effects/pending',
    { scope: 'workflow.read', method: 'GET', query: { limit: 100 } }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !Array.isArray(runtime.data.data)) return []
  return await sendRuntimeCallbacks(event, runtime.data.data)
}
