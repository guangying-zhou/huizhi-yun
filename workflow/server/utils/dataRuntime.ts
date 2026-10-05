import { workflowCallbackTarget } from './callbackTarget'
import { getHeader, type H3Event } from 'h3'
import { $fetch } from 'ofetch'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { fetchConsoleServiceJson, requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { isSelfHostedServiceTopologyEnabled, selfHostedServiceBinding } from '@hzy/foundation/server/utils/selfHostedServiceTransport'
import { tenantGatewayServiceBinding } from '@hzy/foundation/server/utils/cloudflareServiceBinding'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { loadNotificationActionTargetCatalog } from '@hzy/foundation/server/utils/notificationActionTarget'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'
import {
  deliverWorkflowRuntimeNotifications,
  workflowActionTargetCatalogFailureCause,
  type RuntimeNotification,
  type WorkflowNotificationDependencies
} from './runtimeNotifications'
import { withWorkflowEffectCheckpointTokenDenial } from './effectCheckpointTokenDenials'
import {
  deliverWorkflowActionableLifecyclesWithDependencies,
  type ActionableLifecycleDependencies,
  type RuntimeActionableLifecycle
} from './runtimeActionableLifecycles'
import { verifiedLocalWorkflowCallbackHeaders, verifiedSelfHostedCallbackHeaders } from './localCallbackContext'

interface RuntimeCallback {
  effectId?: number
  versionNo?: number
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
    notificationDetailActor?: { uid: string, tenantId: string, deploymentId: string }
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
    workflowProxyActor: options.workflowProxyActor,
    notificationDetailActor: options.notificationDetailActor,
    // Runtime effect/drain routes require the exact, unprefixed capability in
    // the token (workflow_effect_auth.go); do not audience-qualify it.
    ...(options.scope === 'workflow:integration_operation:execute' ? { capabilityFormat: 'business' as const } : {})
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
    warn: (message, detail) => console.warn(message, detail),
    loadActionTargetCatalog: runtimeEvent => loadNotificationActionTargetCatalog(runtimeEvent, {
      onBundleError: error => console.error('[WorkflowRuntime] 签名应用目录加载失败', {
        code: 'workflow_action_target_catalog_unavailable',
        causeCode: 'policy_bundle_load_failed',
        ...workflowActionTargetCatalogFailureCause(error)
      })
    }),
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
    request: (url, options) => fetchConsoleServiceJson(event, url, {
      ...options,
      headers: { ...trustedServiceRequestHeaders(event), ...options.headers }
    }),
    resolveConsoleBaseUrl: runtimeEvent => resolveServiceAppBaseUrl(runtimeEvent, 'console'),
    checkpoint: checkpointWorkflowActionableLifecycle,
    publishNotifications: sendWorkflowRuntimeNotifications,
    error: (message, error) => console.error(message, error)
  },
  publishPrerequisites = true
) {
  return await deliverWorkflowActionableLifecyclesWithDependencies(event, lifecycles, dependencies, publishPrerequisites)
}

async function checkpointWorkflowActionableLifecycle(event: H3Event, effectId: number, versionNo: number, outcome: 'ack' | 'fail', code?: string, httpStatus?: number) {
  const runtime = await withWorkflowEffectCheckpointTokenDenial('actionable', () => maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(
    event,
    `/v1/workflow/actionable-lifecycle-effects/${effectId}/${outcome}`,
    { scope: 'workflow:integration_operation:execute', method: 'POST', body: outcome === 'fail' ? { expectedEffectVersion: versionNo, code: code || 'console_actionable_lifecycle_failed', http_status: httpStatus } : { expectedEffectVersion: versionNo } }
  ))
  if (!runtime.handled || runtime.data.code !== 0) {
    throw new Error(`workflow_actionable_lifecycle_${outcome}_failed`)
  }
  return runtime.data.data
}

interface RuntimeNotificationEffect {
  effectId: number
  versionNo: number
  notification: RuntimeNotification
}

async function checkpointWorkflowNotification(event: H3Event, effectId: number, versionNo: number, outcome: 'ack' | 'fail') {
  const runtime = await withWorkflowEffectCheckpointTokenDenial('notification', () => maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(
    event,
    `/v1/workflow/notification-effects/${effectId}/${outcome}`,
    { scope: 'workflow:integration_operation:execute', method: 'POST', body: outcome === 'fail' ? { expectedEffectVersion: versionNo, code: 'notification_delivery_failed' } : { expectedEffectVersion: versionNo } }
  ))
  if (!runtime.handled || runtime.data.code !== 0) {
    throw new Error(`workflow_notification_effect_${outcome}_failed`)
  }
}

// Durable "new to-do" notifications. Runs before the lifecycle drain, whose
// Runtime query holds back a CAS until the projection's creation is delivered.
// A skipped notification can never be published (no recipients or a broken
// contract), so it is acknowledged instead of retried forever.
export async function drainWorkflowNotificationOutbox(event: H3Event) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<RuntimeNotificationEffect[]>>(
    event,
    '/v1/workflow/notification-effects/pending',
    { scope: 'workflow:integration_operation:execute', method: 'GET', query: { limit: 100 } }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !Array.isArray(runtime.data.data)) return []
  const results: Array<{ effectId: number, status: string, code?: string }> = []
  for (const effect of runtime.data.data) {
    const effectId = Number(effect?.effectId)
    const versionNo = Number(effect?.versionNo)
    if (!Number.isSafeInteger(effectId) || effectId <= 0 || !Number.isSafeInteger(versionNo) || versionNo <= 0 || !effect.notification) continue
    const [result] = await sendWorkflowRuntimeNotifications(event, [effect.notification])
    const status = result?.status || 'failed'
    try {
      await checkpointWorkflowNotification(event, effectId, versionNo, status === 'failed' ? 'fail' : 'ack')
    } catch (error) {
      console.error('[WorkflowRuntime] 待办创建通知检查点写入失败', error)
    }
    results.push({ effectId, status, code: result?.code })
  }
  return results
}

export async function drainWorkflowActionableLifecycleOutbox(event: H3Event) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<RuntimeActionableLifecycle[]>>(
    event,
    '/v1/workflow/actionable-lifecycle-effects/pending',
    { scope: 'workflow:integration_operation:execute', method: 'GET', query: { limit: 100 } }
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
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, callback.versionNo, 'fail', 'invalid_callback_target')
      continue
    }

    const target = workflowCallbackTarget(appCode)
    const localOnly = process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true'
    // Self-hosted single site: dial the target process on loopback with the
    // verified Gateway context (never the public ingress, which strips it).
    const selfHosted = !localOnly && !tenantGatewayServiceBinding(event) && isSelfHostedServiceTopologyEnabled()
    const selfHostedRoute = selfHosted ? resolveTrustedServiceAppRoute(event, target.appCode) : null
    const baseUrl = localOnly
      ? (target.appCode === 'enterprise' ? String(process.env.HZY0_LOCAL_ENTERPRISE_URL || '') : '')
      : selfHosted ? (selfHostedRoute?.baseUrl || '') : resolveServiceAppBaseUrl(event, target.appCode)
    if (localOnly && (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/enterprise\/?$/u.test(baseUrl) || tenantGatewayServiceBinding(event))) {
      results.push({ callback, status: 'failed', error: 'local_callback_target_unavailable' })
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, callback.versionNo, 'fail', 'local_callback_target_unavailable')
      continue
    }
    if (!baseUrl) {
      results.push({ callback, status: 'failed', error: 'callback_app_url_unavailable' })
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, callback.versionNo, 'fail', 'callback_app_url_unavailable')
      continue
    }
    const callbackUrl = `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`

    try {
      const accessToken = await requestServiceAccessToken({
        audience: target.audience,
        scope: target.scope,
        event
      })

      const localHeaders = localOnly
        ? localWorkflowCallbackHeaders(event, target.appCode)
        : selfHosted ? selfHostedWorkflowCallbackHeaders(event, target.appCode, selfHostedRoute) : {}
      const headers = {
        ...localHeaders,
        'authorization': `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(payload.event ? { 'x-workflow-event': String(payload.event) } : {})
      }
      const gatewayBinding = selfHosted ? selfHostedServiceBinding(target.appCode) : tenantGatewayServiceBinding(event)
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
      if (callback.effectId) await checkpointWorkflowCallback(event, callback.effectId, callback.versionNo, 'ack')
      results.push({ callback, status: 'delivered' })
    } catch (error) {
      console.error('[WorkflowRuntime] 回调失败:', error)
      const message = error instanceof Error ? error.message : String(error)
      if (callback.effectId) {
        await checkpointWorkflowCallback(event, callback.effectId, callback.versionNo, 'fail', 'callback_delivery_failed').catch((checkpointError) => {
          console.error('[WorkflowRuntime] 回调失败状态写回失败:', checkpointError)
        })
      }
      results.push({ callback, status: 'failed', error: message })
    }
  }
  return results
}

function selfHostedWorkflowCallbackHeaders(event: H3Event, appCode: string, route: ReturnType<typeof resolveTrustedServiceAppRoute>) {
  return verifiedSelfHostedCallbackHeaders({
    appCode,
    context: resolveTrustedTenantGatewayContext(event),
    route,
    forwardedHeaders: trustedServiceRequestHeaders(event, appCode)
  })
}

function localWorkflowCallbackHeaders(event: H3Event, appCode: string) {
  return verifiedLocalWorkflowCallbackHeaders({
    appCode,
    context: resolveTrustedTenantGatewayContext(event),
    canonicalRuntimeUrl: getHeader(event, 'x-hzy-data-runtime-url') || '',
    dialUrl: getHeader(event, 'x-hzy-local-runtime-dial-url') || '',
    forwardedHeaders: trustedServiceRequestHeaders(event, appCode)
  })
}

async function checkpointWorkflowCallback(
  event: H3Event,
  effectId: number,
  versionNo: number | undefined,
  outcome: 'ack' | 'fail',
  code?: string
) {
  const runtime = await withWorkflowEffectCheckpointTokenDenial('callback', () => maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(
    event,
    `/v1/workflow/callback-effects/${effectId}/${outcome}`,
    {
      scope: 'workflow:integration_operation:execute',
      method: 'POST',
      body: outcome === 'fail' ? { expectedEffectVersion: versionNo, code: code || 'callback_delivery_failed' } : { expectedEffectVersion: versionNo }
    }
  ))
  if (!runtime.handled || runtime.data.code !== 0) {
    throw new Error(`workflow_callback_${outcome}_failed`)
  }
}

export async function drainWorkflowCallbackOutbox(event: H3Event) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<RuntimeCallback[]>>(
    event,
    '/v1/workflow/callback-effects/pending',
    { scope: 'workflow:integration_operation:execute', method: 'GET', query: { limit: 100 } }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !Array.isArray(runtime.data.data)) return []
  return await sendRuntimeCallbacks(event, runtime.data.data)
}

interface WorkflowDeliveryDiagnostics {
  dependencyBlocked: number
  abandonedDependencyBlocked: number
  notification: { abandoned: number }
  actionable: { abandoned: number }
  callback: { abandoned: number }
}

export async function workflowDeliveryDiagnostics(event: H3Event) {
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<WorkflowDeliveryDiagnostics>>(
    event,
    '/v1/workflow/delivery-effects/status',
    { scope: 'workflow:integration_operation:execute', method: 'GET' }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !runtime.data.data) {
    throw new Error('workflow_delivery_diagnostics_unavailable')
  }
  const data = runtime.data.data
  const counts = [data.notification?.abandoned, data.actionable?.abandoned, data.callback?.abandoned,
    data.dependencyBlocked, data.abandonedDependencyBlocked]
  if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('workflow_delivery_diagnostics_invalid')
  }
  return data
}
