/**
 * 通用通知工具 — 优先通过客户侧 notification-runtime 发送
 *
 * 由 Foundation 层统一提供，各业务模块直接调用 sendNotification()。
 * 采用 textcard 消息格式，测试重定向应通过 Console 运行时配置注入。
 */
import type { H3Event } from 'h3'
import { getWecomIntegrationAccessToken, getWecomIntegrationConfig } from './wecomIntegration'
import { getConsoleRuntimeConfig } from './consoleRuntime'
import { getRuntimeSetting } from './runtimeSettings'
import { requestServiceAccessToken } from './serviceOidc'

export interface NotifyParams {
  touser: string | string[]
  title: string
  description: string
  url: string
  btntxt?: string
  event?: H3Event | null
  integrationCode?: string
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

function truthy(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(stringValue(value).toLowerCase())
}

async function resolveNotificationRuntimeUrl(event?: H3Event | null) {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
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

  const fromSettings = await getRuntimeSetting<string>('notification.runtimeApiUrl', '', { ttlMs: 60000 })
    .catch(() => '')
  return normalizeBaseUrl(fromSettings || '')
}

function resolveNotificationRuntimeToken(event?: H3Event | null) {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  return getConfigValue(config, [
    'hzy.notificationRuntime.token',
    'notificationRuntime.token'
  ]) || envValue(event, [
    'HZY_NOTIFICATION_RUNTIME_TOKEN'
  ])
}

function notificationRuntimeAudience(event?: H3Event | null) {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  return getConfigValue(config, [
    'hzy.notificationRuntime.audience',
    'notificationRuntime.audience'
  ]) || envValue(event, [
    'HZY_NOTIFICATION_RUNTIME_AUDIENCE'
  ]) || 'notification-runtime'
}

function allowLegacyFallback(event?: H3Event | null) {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  return truthy(getConfigValue(config, [
    'hzy.notificationRuntime.legacyFallback',
    'notificationRuntime.legacyFallback'
  ]) || envValue(event, [
    'HZY_NOTIFICATION_RUNTIME_LEGACY_FALLBACK'
  ]) || (process.env.NODE_ENV === 'production' ? '' : 'true'))
}

async function sendViaNotificationRuntime(params: NotifyParams, touser: string, runtimeUrl: string) {
  const token = resolveNotificationRuntimeToken(params.event)
    || await requestServiceAccessToken({
      audience: notificationRuntimeAudience(params.event),
      scope: 'notification-runtime:send',
      event: params.event
    })

  return await $fetch(`${runtimeUrl}/v1/notifications/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: {
      channel: 'wecom',
      integrationCode: params.integrationCode || 'wecom.default',
      touser,
      title: params.title,
      description: params.description,
      url: params.url,
      btntxt: params.btntxt || '查看详情'
    },
    timeout: 15000
  })
}

/**
 * 发送企业微信 textcard 消息（统一入口）
 * - 优先通过 notification-runtime 调用客户侧固定出口 IP
 * - 未配置 runtime 时保留 Console integration 直连企业微信 legacy 路径
 * - 支持运行时 notifyRedirectTo 测试重定向
 */
export async function sendNotification(params: NotifyParams) {
  const config = useRuntimeConfig()
  const redirectTo = config.notifyRedirectTo
  let touser: string
  if (redirectTo) {
    const originalTouser = Array.isArray(params.touser)
      ? params.touser.join('|')
      : params.touser
    touser = redirectTo as string
    console.log(
      `[Notify] Redirecting notification from [${originalTouser}] to [${redirectTo}]`
    )
  } else {
    touser = Array.isArray(params.touser)
      ? params.touser.join('|')
      : params.touser
  }

  const runtimeUrl = await resolveNotificationRuntimeUrl(params.event)
  if (runtimeUrl) {
    try {
      const response = await sendViaNotificationRuntime(params, touser, runtimeUrl)
      console.log('[Notify] Sent via notification-runtime:', {
        runtimeUrl,
        touser,
        title: params.title
      })
      return response
    } catch (error) {
      console.error('[Notify] notification-runtime failed:', error)
      if (!allowLegacyFallback(params.event)) {
        throw error
      }
      console.warn('[Notify] Falling back to legacy WeCom direct send')
    }
  }

  try {
    const wecomConfig = await getWecomIntegrationConfig()
    const accessToken = await getWecomIntegrationAccessToken(wecomConfig.integrationCode)
    const response = await $fetch(`${wecomConfig.baseUrl}/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      body: {
        touser,
        msgtype: 'textcard',
        agentid: Number(wecomConfig.agentid),
        textcard: {
          title: params.title,
          description: params.description,
          url: params.url,
          btntxt: params.btntxt || '查看详情'
        }
      }
    })

    console.log('[Notify] Sent:', {
      touser,
      title: params.title,
      response
    })

    return response
  } catch (error) {
    console.error('[Notify] Failed:', error)
    throw error
  }
}
