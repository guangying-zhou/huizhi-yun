import { createError, getHeader, getRequestURL, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { resolveTenantGatewayServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import {
  checkConsoleIntegration,
  createConsoleIntegration,
  getConsoleIntegration,
  listConsoleIntegrations,
  rotateConsoleIntegrationCredential,
  updateConsoleIntegration
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getOidcIssuer } from '~~/server/utils/oidc'
import { getSystemParameter } from '~~/server/utils/systemParameters'
import type { VaultActor } from '~~/server/utils/vault'

const NOTIFICATION_RUNTIME_AUDIENCE = 'notification-runtime'
const NOTIFICATION_RUNTIME_SEND_SCOPE = 'notification-runtime:send'

type ExternalIntegrationFetch = <T = unknown>(
  url: string,
  options?: Record<string, unknown>
) => Promise<T>

const fetchExternalIntegration = fetchExternal as unknown as ExternalIntegrationFetch

export interface IntegrationCredentialInput {
  secretCode?: unknown
  versionNo?: unknown
  expiresAt?: unknown
}

export interface UpsertIntegrationInput {
  integrationCode?: unknown
  integrationType?: unknown
  integrationName?: unknown
  category?: unknown
  providerCode?: unknown
  baseUrl?: unknown
  config?: Record<string, unknown> | null
  credential?: IntegrationCredentialInput | null
  status?: unknown
  requestedBy?: unknown
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function notificationTestActionUrl(event: H3Event) {
  const trustedTenantBaseUrl = resolveTenantGatewayServiceAppBaseUrl(event, 'console', { basePath: '/' })
  if (trustedTenantBaseUrl) {
    return new URL('/notifications', trustedTenantBaseUrl).toString()
  }
  if (stringValue(getHeader(event, 'x-hzy-gateway')) === 'tenant-gateway') {
    throw createError({
      statusCode: 503,
      message: 'Trusted tenant gateway URL is required for notification links'
    })
  }
  return new URL('/notifications', getRequestURL(event).origin).toString()
}

function assertCode(value: unknown, field: string) {
  const normalized = stringValue(value)
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,126}[a-zA-Z0-9]$/.test(normalized)) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key]
    if (value !== undefined && value !== null && stringValue(value)) {
      return stringValue(value)
    }
  }
  return ''
}

function normalizeWecomBaseUrl(baseUrl: string | null) {
  return stringValue(baseUrl || 'https://qyapi.weixin.qq.com').replace(/\/+$/, '')
}

function normalizeBaseUrl(value: string | null) {
  return stringValue(value).replace(/\/+$/, '')
}

function assertWecomConfig(config: Record<string, unknown>) {
  const corpid = getConfigValue(config, ['corpid', 'corpId'])
  const agentid = getConfigValue(config, ['agentid', 'agentId'])
  if (!corpid) {
    throw createError({ statusCode: 400, message: 'WeCom corpid is required' })
  }
  const agentIdNumber = Number(agentid)
  if (!agentid || !Number.isFinite(agentIdNumber) || agentIdNumber <= 0) {
    throw createError({ statusCode: 400, message: 'WeCom agentid is required' })
  }
  return {
    corpid,
    agentid: Math.floor(agentIdNumber)
  }
}

function assertDingTalkConfig(config: Record<string, unknown>) {
  const appKey = getConfigValue(config, ['appKey', 'clientId', 'appId'])
  const corpId = getConfigValue(config, ['corpId', 'corp_id'])
  const robotCode = getConfigValue(config, ['robotCode']) || appKey
  if (!appKey) {
    throw createError({ statusCode: 400, message: 'DingTalk Client ID / AppKey is required' })
  }
  if (!robotCode) {
    throw createError({ statusCode: 400, message: 'DingTalk robotCode is required for notifications' })
  }
  return { appKey, corpId, robotCode }
}

export function isPlausibleDingTalkOAuthClientId(value: unknown) {
  const clientId = stringValue(value)
  if (!clientId) return false
  // Enterprise internal AgentId values are numeric and UnifiedAppId values
  // are UUIDs. Neither is the OAuth Client ID/AppKey accepted by the web
  // authorization endpoint.
  if (/^\d+$/.test(clientId)) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) return false
  return true
}

async function resolveNotificationRuntimeUrl() {
  const settingValue = await getSystemParameter('notification.runtimeApiUrl')
    .catch(() => null)
  return normalizeBaseUrl(settingValue || process.env.HZY_NOTIFICATION_RUNTIME_API_URL || process.env.HZY_NOTIFICATION_RUNTIME_URL || null)
}

async function resolveNotificationDeliveryTarget() {
  const connectorEnabled = stringValue(await getSystemParameter('connector.notificationsEnabled').catch(() => null)).toLowerCase() === 'true'
  if (connectorEnabled) {
    const runtimeUrl = normalizeBaseUrl(await getSystemParameter('connector.runtimeApiUrl').catch(() => null))
    if (!runtimeUrl) {
      throw createError({ statusCode: 503, message: 'connector-runtime notifications are enabled but runtime URL is missing' })
    }
    return {
      runtimeUrl,
      audience: 'connector-runtime',
      scope: 'connector-runtime:notifications:send',
      deliveryMode: 'connector-runtime'
    }
  }
  return {
    runtimeUrl: await resolveNotificationRuntimeUrl(),
    audience: NOTIFICATION_RUNTIME_AUDIENCE,
    scope: NOTIFICATION_RUNTIME_SEND_SCOPE,
    deliveryMode: 'notification-runtime'
  }
}

async function issueNotificationDeliveryToken(event: H3Event, target: Awaited<ReturnType<typeof resolveNotificationDeliveryTarget>>) {
  return await requestServiceAccessToken({
    event,
    audience: target.audience,
    scope: target.scope
  })
}

function responseMessage(error: unknown) {
  const err = error as {
    message?: string
    statusMessage?: string
    data?: {
      message?: string
      statusMessage?: string
      error?: string
    }
  }
  return stringValue(err?.data?.message || err?.data?.statusMessage || err?.data?.error || err?.statusMessage || err?.message)
}

function notificationRuntimeErrorCode(error: unknown) {
  const err = error as {
    data?: {
      error?: string
      data?: { error?: string }
    }
  }
  return stringValue(err?.data?.data?.error || err?.data?.error)
}

function notificationRuntimeStatusCode(error: unknown) {
  const err = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
  }
  return Number(err?.statusCode || err?.status || err?.response?.status || 0)
}

async function probeNotificationRuntimeAuthorization(
  event: H3Event,
  target: Awaited<ReturnType<typeof resolveNotificationDeliveryTarget>>
) {
  const token = await issueNotificationDeliveryToken(event, target)
  try {
    await fetchExternalIntegration(`${target.runtimeUrl}/v1/notifications/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      timeout: 10000,
      body: {}
    })
    return {
      ok: false,
      message: 'Runtime accepted an intentionally invalid notification request'
    }
  } catch (error) {
    const errorCode = notificationRuntimeErrorCode(error)
    if (
      notificationRuntimeStatusCode(error) === 400
      && ['invalid_touser', 'invalid_message'].includes(errorCode)
    ) {
      return {
        ok: true,
        message: '服务令牌签发与 Runtime JWT 校验通过'
      }
    }
    return {
      ok: false,
      message: responseMessage(error) || 'Runtime service-token verification failed'
    }
  }
}

function mapNotificationRuntimeSendError(event: H3Event, error: unknown, provider: NotificationTestProvider = 'wecom') {
  const runtimeLabel = provider === 'dingtalk' ? 'Enterprise Connector Runtime' : 'Notification Runtime'
  const integrationCode = provider === 'dingtalk' ? 'dingtalk.default' : 'wecom.default'
  const issuerSetting = provider === 'dingtalk'
    ? 'HZY_CONNECTOR_RUNTIME_JWT_ISSUER'
    : 'HZY_NOTIFICATION_RUNTIME_JWT_ISSUER'
  const integrationGrantGuidance = provider === 'dingtalk'
    ? '请先在集成中心检测钉钉配置并修复服务授权。'
    : '请先点击“检测企业微信配置”自动修复服务授权。'
  if (
    notificationRuntimeErrorCode(error) === 'invalid_jwt'
    && /invalid issuer/i.test(responseMessage(error))
  ) {
    return createError({
      statusCode: 409,
      statusMessage: `${runtimeLabel} JWT issuer mismatch`,
      message: `${runtimeLabel} 仍使用旧 JWT Issuer；请重新生成并执行一键安装命令，使 ${issuerSetting} 更新为 ${getOidcIssuer(event)}`
    })
  }
  if (
    notificationRuntimeErrorCode(error) === 'console_request_failed'
    && /service integration identity is incomplete/i.test(responseMessage(error))
  ) {
    return createError({
      statusCode: 409,
      statusMessage: `${runtimeLabel} service identity is incomplete`,
      message: `${runtimeLabel} 服务身份缺少 appCode；请在对应运行时页面重新生成一次安装指令以修复服务身份。`
    })
  }
  if (
    notificationRuntimeErrorCode(error) === 'console_request_failed'
    && /integration not found/i.test(responseMessage(error))
  ) {
    return createError({
      statusCode: 409,
      statusMessage: `${runtimeLabel} integration grant is incomplete`,
      message: `${runtimeLabel} 服务未获授权读取 ${integrationCode}；${integrationGrantGuidance}`
    })
  }
  return error
}

type ConfigCheckStatus = 'pass' | 'warn' | 'fail'

function configCheckItem(key: string, label: string, status: ConfigCheckStatus, message: string) {
  return { key, label, status, message }
}

export interface IntegrationView {
  integrationCode: string
  integrationType: string
  integrationName: string
  category: string
  providerCode: string | null
  baseUrl: string | null
  config: Record<string, unknown>
  connectivityStatus: string
  lastCheckedAt: string | null
  lastErrorMessage: string | null
  status: string
  currentCredential: null | {
    credentialName: string
    credentialVersionNo: number | null
    versionNo: number | null
    secretCode: string
    secretRef: string
    secretUsageType: string
    status: string
  }
  createdAt: string
  updatedAt: string
}

export async function listIntegrations(
  event: H3Event,
  query: Record<string, unknown>,
  allowedIntegrationCodes?: ReadonlySet<string>
) {
  const response = await listConsoleIntegrations(event, query)
  const items = response.data.items
  if (!allowedIntegrationCodes) return { items }
  return {
    items: items.filter(item => allowedIntegrationCodes.has(stringValue(item.integrationCode)))
  }
}

export async function getIntegration(
  event: H3Event,
  integrationCode: string,
  allowedIntegrationCodes?: ReadonlySet<string>
) {
  if (allowedIntegrationCodes && !allowedIntegrationCodes.has(integrationCode)) return null
  try {
    const response = await getConsoleIntegration(event, integrationCode)
    return response.data as unknown as IntegrationView
  } catch (error) {
    if (Number((error as { statusCode?: unknown })?.statusCode || 0) === 404) return null
    throw error
  }
}

export async function hasActiveIntegrationCredentialBinding(event: H3Event, integrationCode: string) {
  const integration = await getIntegration(event, integrationCode)
  return Boolean(
    integration?.status === 'active'
    && integration.currentCredential?.status === 'active'
    && integration.currentCredential?.versionNo
  )
}

export async function createIntegration(event: H3Event, input: UpsertIntegrationInput) {
  const response = await createConsoleIntegration(event, input as Record<string, unknown>)
  return response.data
}

export async function updateIntegration(
  event: H3Event,
  integrationCode: string,
  input: Partial<UpsertIntegrationInput>
) {
  const response = await updateConsoleIntegration(
    event,
    integrationCode,
    input as Record<string, unknown>
  )
  return response.data
}

export async function rotateIntegrationCredential(
  event: H3Event,
  integrationCode: string,
  input: IntegrationCredentialInput
) {
  const response = await rotateConsoleIntegrationCredential(
    event,
    integrationCode,
    input as Record<string, unknown>
  )
  return response.data
}

export async function checkIntegration(input: {
  event: H3Event
  integrationCode: string
  actor: VaultActor
}) {
  const response = await checkConsoleIntegration(input.event, input.integrationCode)
  return response.data
}

type NotificationTestProvider = 'wecom' | 'dingtalk'

async function sendIntegrationTestMessage(input: {
  event: H3Event
  integrationCode: string
  touser: unknown
  requestKey: unknown
}, provider: NotificationTestProvider) {
  const providerLabel = provider === 'dingtalk' ? 'DingTalk' : 'WeCom'
  const providerTitle = provider === 'dingtalk' ? '钉钉' : '企业微信'
  const code = assertCode(input.integrationCode, 'integrationCode')
  const touser = stringValue(input.touser)
  if (!touser || touser.length > 256) {
    throw createError({ statusCode: 400, message: `${providerLabel} account is required` })
  }
  const requestKey = stringValue(input.requestKey)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(requestKey)) {
    throw createError({ statusCode: 400, message: 'requestKey is required for idempotent test delivery' })
  }

  const row = await getIntegration(input.event, code)
  if (!row) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }
  if (row.integrationType !== provider) {
    throw createError({ statusCode: 400, message: `Integration is not a ${providerLabel} integration` })
  }
  if (!row.currentCredential || row.currentCredential.status !== 'active') {
    throw createError({ statusCode: 409, message: 'Integration has no active credential' })
  }

  const checkedAt = new Date().toISOString()
  const parsedConfig = row.config
  const message = {
    title: `汇智云${providerTitle}通知测试`,
    description: [
      `这是一条由汇智云 Console 发送的${providerTitle}测试消息。`,
      `集成：${code}`
    ].join('\n'),
    url: notificationTestActionUrl(input.event),
    btntxt: '查看'
  }
  const summary: Record<string, unknown> = {
    integrationCode: code,
    touser,
    checkMode: `${provider}_message_send`
  }
  if (provider === 'dingtalk') {
    const config = assertDingTalkConfig(parsedConfig)
    summary.appKeyLast4 = config.appKey.slice(-4)
    summary.robotCodeConfigured = Boolean(config.robotCode)
  } else {
    const config = assertWecomConfig(parsedConfig)
    summary.agentid = config.agentid
  }
  const idempotencyKey = provider === 'wecom'
    ? `console:notification-runtime:wecom-test:${requestKey}`
    : `console:connector-runtime:dingtalk-test:${requestKey}`

  try {
    const target = await resolveNotificationDeliveryTarget()
    if (!target.runtimeUrl) {
      throw createError({ statusCode: 503, message: 'notification-runtime is not configured' })
    }
    if (provider === 'dingtalk' && target.deliveryMode !== 'connector-runtime') {
      throw createError({
        statusCode: 409,
        message: 'DingTalk notifications require Enterprise Connector Runtime'
      })
    }
    summary.deliveryMode = target.deliveryMode
    summary.runtimeUrl = target.runtimeUrl
    const token = await issueNotificationDeliveryToken(input.event, target)
    const response = await fetchExternalIntegration<Record<string, unknown>>(`${target.runtimeUrl}/v1/notifications/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      timeout: 15000,
      body: {
        channel: provider,
        integrationCode: code,
        sourceAppCode: 'console',
        touser,
        title: message.title,
        description: message.description,
        url: message.url,
        btntxt: message.btntxt,
        idempotencyKey
      }
    })

    return {
      integrationCode: code,
      touser,
      status: 'sent',
      sentAt: checkedAt,
      deliveryMode: summary.deliveryMode,
      requestKey,
      providerResult: response
    }
  } catch (error) {
    const mappedError = mapNotificationRuntimeSendError(input.event, error, provider)
    throw mappedError
  }
}

export async function sendWecomIntegrationTestMessage(input: {
  event: H3Event
  integrationCode: string
  touser: unknown
  requestKey: unknown
}) {
  return await sendIntegrationTestMessage(input, 'wecom')
}

export async function sendDingTalkIntegrationTestMessage(input: {
  event: H3Event
  integrationCode: string
  touser: unknown
  requestKey: unknown
}) {
  return await sendIntegrationTestMessage(input, 'dingtalk')
}

export async function checkWecomNotificationRuntimeConfig(input: {
  event: H3Event
  integrationCode?: unknown
  actor: VaultActor
}) {
  const code = assertCode(input.integrationCode || 'wecom.default', 'integrationCode')
  const checkedAt = new Date().toISOString()
  const checks: Array<ReturnType<typeof configCheckItem>> = []

  const target = await resolveNotificationDeliveryTarget()
  const runtimeUrl = target.runtimeUrl
  if (runtimeUrl) {
    checks.push(configCheckItem('runtimeApiUrl', 'Runtime 地址', 'pass', runtimeUrl))
    try {
      await Promise.all([
        fetchExternalIntegration(`${runtimeUrl}/runtime/health`, { timeout: 10000 }),
        fetchExternalIntegration(`${runtimeUrl}/runtime/capabilities`, { timeout: 10000 })
      ])
      checks.push(configCheckItem('runtimeReachable', 'Runtime 可达性', 'pass', 'health 和 capabilities 均可访问'))
    } catch (error) {
      checks.push(configCheckItem('runtimeReachable', 'Runtime 可达性', 'fail', responseMessage(error) || 'Runtime endpoint is not reachable'))
    }
    try {
      const authProbe = await probeNotificationRuntimeAuthorization(input.event, target)
      checks.push(configCheckItem(
        'runtimeAuthorization',
        'Runtime JWT 认证',
        authProbe.ok ? 'pass' : 'fail',
        authProbe.message
      ))
    } catch (error) {
      checks.push(configCheckItem(
        'runtimeAuthorization',
        'Runtime JWT 认证',
        'fail',
        responseMessage(error) || 'Runtime service-token verification failed'
      ))
    }
  } else {
    checks.push(configCheckItem('runtimeApiUrl', 'Runtime 地址', 'fail', 'notification.runtimeApiUrl is not configured'))
    checks.push(configCheckItem('runtimeReachable', 'Runtime 可达性', 'warn', 'Runtime 地址未配置，跳过连通性检测'))
    checks.push(configCheckItem('runtimeAuthorization', 'Runtime JWT 认证', 'warn', 'Runtime 地址未配置，跳过认证检测'))
  }

  const row = await getIntegration(input.event, code).catch(() => null)
  if (!row) {
    checks.push(configCheckItem('integration', '企业微信集成', 'fail', `${code} is not configured`))
    return {
      integrationCode: code,
      checkedAt,
      ready: false,
      runtime: {
        apiUrl: runtimeUrl || null,
        deliveryMode: target.deliveryMode
      },
      integration: null,
      checks
    }
  }

  checks.push(configCheckItem(
    'integration',
    '企业微信集成',
    row.integrationType === 'wecom' ? 'pass' : 'fail',
    row.integrationType === 'wecom' ? `${code} 已配置` : `${code} is ${row.integrationType}, expected wecom`
  ))
  checks.push(configCheckItem(
    'integrationStatus',
    '集成状态',
    row.status === 'active' ? 'pass' : 'fail',
    row.status === 'active' ? 'active' : row.status
  ))

  const config = row.config
  const corpid = getConfigValue(config, ['corpid', 'corpId'])
  const agentid = getConfigValue(config, ['agentid', 'agentId'])
  const agentidNumber = Number(agentid)
  const baseUrl = normalizeWecomBaseUrl(row.baseUrl)

  checks.push(configCheckItem('baseUrl', '企业微信 API Base URL', baseUrl ? 'pass' : 'fail', baseUrl || 'empty'))
  checks.push(configCheckItem('corpid', 'Corp ID', corpid ? 'pass' : 'fail', corpid ? '已填写' : 'missing corpid'))
  checks.push(configCheckItem(
    'agentid',
    'Agent ID',
    agentid && Number.isFinite(agentidNumber) && agentidNumber > 0 ? 'pass' : 'fail',
    agentid ? String(agentid) : 'missing agentid'
  ))

  checks.push(configCheckItem(
    'credential',
    'CorpSecret 凭证',
    row.currentCredential?.status === 'active' ? 'pass' : 'fail',
    row.currentCredential?.status === 'active' ? '已绑定有效凭证' : 'missing credential'
  ))
  const providerCheck = await checkIntegration({
    event: input.event,
    integrationCode: code,
    actor: input.actor
  })
  checks.push(configCheckItem(
    'credentialResolve',
    '客户侧凭证与接口检测',
    providerCheck.status === 'healthy' ? 'pass' : 'fail',
    providerCheck.status === 'healthy'
      ? 'Tenant Runtime 检测通过'
      : String(providerCheck.errorMessage || 'Tenant Runtime 检测失败')
  ))

  return {
    integrationCode: code,
    checkedAt,
    ready: !checks.some(item => item.status === 'fail'),
    runtime: {
      apiUrl: runtimeUrl || null,
      deliveryMode: target.deliveryMode
    },
    integration: {
      exists: true,
      status: row.status,
      baseUrl,
      corpidConfigured: Boolean(corpid),
      agentidConfigured: Boolean(agentid),
      credentialBound: row.currentCredential?.status === 'active',
      secretResolved: providerCheck.status === 'healthy'
    },
    checks
  }
}
