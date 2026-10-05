/**
 * 通用通知工具 — Console 站内消息 + notification-runtime 外部通知
 *
 * 由 Foundation 层统一提供，各业务模块直接调用 sendNotification()。
 * 采用 textcard 消息格式，测试重定向应通过 Console 运行时配置注入。
 */
import { createError, type H3Event } from 'h3'
import { getConsoleRuntimeConfig } from './consoleRuntime'
import { getRuntimeSetting } from './runtimeSettings'
import { requestServiceAccessToken } from './serviceOidc'
import { publishNotification, type PublishNotificationInput } from './notifications'
import { fetchExternal } from './externalFetch'

export interface NotifyParams {
  touser: string | string[]
  externalRecipients?: string | string[]
  channel?: 'wecom' | 'dingtalk'
  title: string
  description: string
  url: string
  /** Safe URL persisted in Console when the external URL carries a bearer secret. */
  inAppUrl?: string
  btntxt?: string
  event?: H3Event | null
  integrationCode?: string
  sourceAppCode?: string
  eventType?: string
  category?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  bizType?: string
  bizId?: string | number
  idempotencyKey: string
  metadata?: Record<string, unknown>
}

export interface NotificationDeliveryDependencies {
  resolveSourceAppCode: (params: NotifyParams) => Promise<string> | string
  publishInApp: (input: PublishNotificationInput) => Promise<unknown>
  sendExternal: (params: NotifyParams, touser: string) => Promise<unknown>
}

export interface NotificationChannelResult {
  status: 'fulfilled' | 'rejected' | 'skipped'
  value?: unknown
  reason?: unknown
}

export interface NotificationDeliveryResult {
  sourceAppCode: string
  recipients: string[]
  externalRecipients: string[]
  inApp: NotificationChannelResult
  external: NotificationChannelResult
}

export class NotificationDeliveryError extends Error {
  readonly code = 'notification_delivery_failed'
  readonly statusCode = 502
  readonly failedChannels: Array<'in_app' | 'wecom' | 'dingtalk'>
  readonly result: NotificationDeliveryResult

  constructor(result: NotificationDeliveryResult, externalChannel: 'wecom' | 'dingtalk' = 'wecom') {
    const failedChannels: Array<'in_app' | 'wecom' | 'dingtalk'> = []
    if (result.inApp.status === 'rejected') failedChannels.push('in_app')
    if (result.external.status === 'rejected') failedChannels.push(externalChannel)
    super(`Notification delivery failed for channel(s): ${failedChannels.join(', ')}`)
    this.name = 'NotificationDeliveryError'
    this.failedChannels = failedChannels
    this.result = result
  }
}

type CloudflareEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export function validateNotificationIdempotencyKey(value: unknown) {
  const key = stringValue(value)
  if (!key || key.length > 191) {
    throw createError({
      statusCode: 400,
      message: 'Notifications require an idempotencyKey of at most 191 characters'
    })
  }
  return key
}

export function resolveExternalRecipients(
  params: Pick<NotifyParams, 'channel' | 'externalRecipients'>,
  notifyRedirectTo: unknown
) {
  const redirectTo = stringValue(notifyRedirectTo)
  if ((params.channel || 'wecom') === 'wecom' && redirectTo) return redirectTo
  return params.externalRecipients || undefined
}

export function hzy0InAppOnlyNotifications(env: { HZY0_LOCAL_ENTERPRISE?: string, HZY0_NOTIFICATIONS_IN_APP_ONLY?: string }) {
  return env.HZY0_LOCAL_ENTERPRISE === 'true' && env.HZY0_NOTIFICATIONS_IN_APP_ONLY === 'true'
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }
    const normalized = stringValue(current)
    if (normalized) return normalized
  }
  return ''
}

function cloudflareEnv(event?: H3Event | null): CloudflareEnv {
  if (!event) return {}
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

function envValue(event: H3Event | null | undefined, names: string[]) {
  const cfEnv = cloudflareEnv(event)
  for (const name of names) {
    const cfValue = stringValue(cfEnv[name])
    if (cfValue) return cfValue
  }
  for (const name of names) {
    const processValue = stringValue(process.env[name])
    if (processValue) return processValue
  }
  return ''
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeRecipientUids(value: string | string[], fieldName: string) {
  const raw = (Array.isArray(value) ? value : [value])
    .flatMap(item => stringValue(item).split(/[|,\s]+/))
    .map(item => item.trim())
    .filter(Boolean)
  const recipients = [...new Set(raw)]

  if (recipients.some(uid => uid.toLowerCase() === '@all')) {
    throw createError({
      statusCode: 400,
      message: `${fieldName} does not accept @all; resolve explicit recipient UIDs before sending`
    })
  }
  if (!recipients.length) {
    throw createError({ statusCode: 400, message: `${fieldName} requires at least one recipient UID` })
  }
  return recipients
}

async function resolveNotificationSourceAppCode(params: NotifyParams) {
  const explicit = stringValue(params.sourceAppCode)
  if (explicit) return explicit

  const runtime = await getConsoleRuntimeConfig({ event: params.event || null })
  const inferred = stringValue(runtime.app?.appCode)
  if (!inferred) {
    throw createError({
      statusCode: 503,
      message: 'Notification source app is unavailable from trusted Console runtime config'
    })
  }
  return inferred
}

/**
 * Production dual-channel orchestrator. Dependencies are injected only at the
 * network/config boundary so the delivery semantics can be tested directly.
 */
export async function orchestrateNotificationDelivery(
  params: NotifyParams,
  dependencies: NotificationDeliveryDependencies,
  options: { externalRecipients?: string | string[], inAppOnly?: boolean } = {}
): Promise<NotificationDeliveryResult> {
  const recipients = normalizeRecipientUids(params.touser, 'touser')
  const externalRecipients = options.inAppOnly
    ? []
    : normalizeRecipientUids(options.externalRecipients || params.touser, 'external touser')
  const sourceAppCode = stringValue(params.sourceAppCode) || stringValue(await dependencies.resolveSourceAppCode(params))
  if (!sourceAppCode) {
    throw createError({ statusCode: 503, message: 'Notification source app is required' })
  }
  if (!stringValue(params.title)) {
    throw createError({ statusCode: 400, message: 'Notification title is required' })
  }

  let inAppValue: unknown
  try {
    inAppValue = await dependencies.publishInApp({
      event: params.event,
      sourceAppCode,
      eventType: params.eventType || `${sourceAppCode}.notification`,
      category: params.category || 'general',
      severity: params.severity || 'info',
      title: params.title,
      summary: params.description,
      actionUrl: params.inAppUrl ?? params.url,
      bizType: params.bizType,
      bizId: params.bizId,
      idempotencyKey: params.idempotencyKey,
      recipients,
      channels: ['in_app'],
      metadata: params.metadata
    })
  } catch (error) {
    throw new NotificationDeliveryError({
      sourceAppCode,
      recipients,
      externalRecipients,
      inApp: { status: 'rejected', reason: error },
      external: { status: 'skipped', reason: 'in_app_failed' }
    }, params.channel || 'wecom')
  }

  if (options.inAppOnly) {
    return {
      sourceAppCode,
      recipients,
      externalRecipients,
      inApp: { status: 'fulfilled', value: inAppValue },
      external: { status: 'skipped', reason: 'in_app_only' }
    }
  }

  try {
    const externalValue = await dependencies.sendExternal(
      { ...params, sourceAppCode },
      externalRecipients.join('|')
    )
    return {
      sourceAppCode,
      recipients,
      externalRecipients,
      inApp: { status: 'fulfilled', value: inAppValue },
      external: { status: 'fulfilled', value: externalValue }
    }
  } catch (error) {
    throw new NotificationDeliveryError({
      sourceAppCode,
      recipients,
      externalRecipients,
      inApp: { status: 'fulfilled', value: inAppValue },
      external: { status: 'rejected', reason: error }
    }, params.channel || 'wecom')
  }
}

async function resolveNotificationRuntimeUrl(event?: H3Event | null) {
  const config = useRuntimeConfig(event || undefined) as unknown as Record<string, unknown>
  const configured = getConfigValue(config, [
    'hzy.notificationRuntime.apiUrl',
    'hzy.notificationRuntime.url',
    'notificationRuntime.apiUrl',
    'notificationRuntime.url',
    'hzy.notification.apiUrl',
    'notification.apiUrl'
  ]) || envValue(event, [
    'HZY_NOTIFICATION_RUNTIME_API_URL',
    'HZY_NOTIFICATION_RUNTIME_URL'
  ])
  if (configured) return normalizeBaseUrl(configured)

  const fromRuntimeConfig = await getConsoleRuntimeConfig({ event })
    .then(runtime => stringValue(runtime.notification?.apiUrl))
    .catch(() => '')
  if (fromRuntimeConfig) return normalizeBaseUrl(fromRuntimeConfig)

  const fromSettings = await getRuntimeSetting<string>('notification.runtimeApiUrl', '', {
    ttlMs: 60000,
    event: event || undefined
  })
    .catch(() => '')
  return normalizeBaseUrl(fromSettings || '')
}

async function resolveExternalRuntimeTarget(event?: H3Event | null, channel: 'wecom' | 'dingtalk' = 'wecom') {
  const connectorEnabledEnv = envValue(event, ['HZY_CONNECTOR_RUNTIME_NOTIFICATIONS_ENABLED']).toLowerCase()
  const connectorEnabledSetting = await getRuntimeSetting<boolean>('connector.notificationsEnabled', false, {
    ttlMs: 15000,
    event: event || undefined
  })
    .catch(() => false)
  const connectorEnabled = connectorEnabledEnv === 'true' || (connectorEnabledEnv !== 'false' && connectorEnabledSetting === true)
  if (connectorEnabled) {
    const config = useRuntimeConfig(event || undefined) as unknown as Record<string, unknown>
    const configured = getConfigValue(config, [
      'hzy.connectorRuntime.apiUrl',
      'connectorRuntime.apiUrl'
    ]) || envValue(event, ['HZY_CONNECTOR_RUNTIME_API_URL', 'HZY_CONNECTOR_RUNTIME_URL'])
    const fromSettings = configured || await getRuntimeSetting<string>('connector.runtimeApiUrl', '', {
      ttlMs: 15000,
      event: event || undefined
    }).catch(() => '')
    const runtimeUrl = normalizeBaseUrl(fromSettings || '')
    if (!runtimeUrl) {
      throw createError({ statusCode: 503, message: 'connector-runtime notifications are enabled but runtime URL is missing' })
    }
    return {
      runtimeUrl,
      audience: 'connector-runtime',
      scope: 'connector-runtime:notifications:send',
      staticToken: envValue(event, ['HZY_CONNECTOR_RUNTIME_TOKEN'])
    }
  }
  if (channel === 'dingtalk') {
    throw createError({ statusCode: 503, message: 'DingTalk notification delivery requires connector-runtime notifications' })
  }
  return {
    runtimeUrl: await resolveNotificationRuntimeUrl(event),
    audience: notificationRuntimeAudience(event),
    scope: 'notification-runtime:send',
    staticToken: resolveNotificationRuntimeToken(event)
  }
}

function resolveNotificationRuntimeToken(event?: H3Event | null) {
  const config = useRuntimeConfig(event || undefined) as unknown as Record<string, unknown>
  return getConfigValue(config, [
    'hzy.notificationRuntime.token',
    'notificationRuntime.token'
  ]) || envValue(event, [
    'HZY_NOTIFICATION_RUNTIME_TOKEN'
  ])
}

function notificationRuntimeAudience(event?: H3Event | null) {
  const config = useRuntimeConfig(event || undefined) as unknown as Record<string, unknown>
  return getConfigValue(config, [
    'hzy.notificationRuntime.audience',
    'notificationRuntime.audience'
  ]) || envValue(event, [
    'HZY_NOTIFICATION_RUNTIME_AUDIENCE'
  ]) || 'notification-runtime'
}

async function sendViaNotificationRuntime(params: NotifyParams, touser: string, target: Awaited<ReturnType<typeof resolveExternalRuntimeTarget>>) {
  const token = target.staticToken
    || await requestServiceAccessToken({
      audience: target.audience,
      scope: target.scope,
      event: params.event
    })

  return await fetchExternal<unknown>(`${target.runtimeUrl}/v1/notifications/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: {
      channel: params.channel || 'wecom',
      integrationCode: params.integrationCode || `${params.channel || 'wecom'}.default`,
      sourceAppCode: params.sourceAppCode,
      touser,
      title: params.title,
      description: params.description,
      url: params.url,
      btntxt: params.btntxt || '查看详情',
      idempotencyKey: params.idempotencyKey
    },
    timeout: 15000
  })
}

async function sendExternalNotification(params: NotifyParams, touser: string) {
  const target = await resolveExternalRuntimeTarget(params.event, params.channel || 'wecom')
  if (!target.runtimeUrl) {
    throw createError({
      statusCode: 503,
      message: 'notification-runtime is not configured'
    })
  }
  return await sendViaNotificationRuntime(params, touser, target)
}

/**
 * 统一业务通知入口：每次同时写入 Console 站内消息，并通过
 * notification-runtime 发送企业微信。
 *
 * Console 站内消息是耐久事实源：只有 publish 成功后才尝试外部通道。
 * 任一失败抛出 NotificationDeliveryError，调用方可从 result 识别
 * 外部未尝试或站内已成功的部分交付。
 */
export async function sendNotification(params: NotifyParams) {
  validateNotificationIdempotencyKey(params.idempotencyKey)
  // The hzy0 runner derives both values from its validated private profile.
  // Production and other local stacks keep dual-channel delivery unchanged.
  const inAppOnly = hzy0InAppOnlyNotifications({
    HZY0_LOCAL_ENTERPRISE: process.env.HZY0_LOCAL_ENTERPRISE,
    HZY0_NOTIFICATIONS_IN_APP_ONLY: process.env.HZY0_NOTIFICATIONS_IN_APP_ONLY
  })
  const config = useRuntimeConfig(params.event || undefined)
  const redirectTo = !inAppOnly && (params.channel || 'wecom') === 'wecom'
    ? stringValue(config.notifyRedirectTo)
    : ''
  if (redirectTo) {
    const originalTouser = Array.isArray(params.touser)
      ? params.touser.join('|')
      : params.touser
    console.log(
      `[Notify] Redirecting external notification from [${originalTouser}] to [${redirectTo}]`
    )
  }

  return await orchestrateNotificationDelivery(params, {
    resolveSourceAppCode: resolveNotificationSourceAppCode,
    publishInApp: publishNotification,
    sendExternal: sendExternalNotification
  }, {
    externalRecipients: inAppOnly ? undefined : resolveExternalRecipients(params, config.notifyRedirectTo),
    inAppOnly
  })
}
