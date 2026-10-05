import { createError, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import {
  getIntegration,
  hasActiveIntegrationCredentialBinding,
  isPlausibleDingTalkOAuthClientId
} from './integrations'
import { getSystemParameter } from './systemParameters'

const DEFAULT_INTEGRATION_CODE = 'dingtalk.default'
const IDENTITY_INTEGRATION_CODE = 'dingtalk.identity'
const ALLOWED_IDENTITY_INTEGRATIONS = new Set([IDENTITY_INTEGRATION_CODE, DEFAULT_INTEGRATION_CODE])
const IDENTITY_SCOPE = 'connector-runtime:identity:dingtalk:exchange'

interface IdentityEnvelope {
  code?: number
  data?: {
    provider?: string
    integrationCode?: string
    subject?: { id?: string, kind?: string }
  }
}

const IDENTITY_EXCHANGE_ERRORS = new Map<string, { statusCode: number, message: string }>([
  ['dingtalk_identity_exchange_rejected', { statusCode: 502, message: '钉钉拒绝授权码交换；请从登录页重新发起，并确认网页登录应用版本已发布' }],
  ['dingtalk_identity_profile_failed', { statusCode: 502, message: '钉钉用户资料读取失败；请确认网页登录应用具备用户身份信息权限' }],
  ['dingtalk_identity_mapping_failed', { statusCode: 502, message: '钉钉企业成员映射失败；请确认应用具备通讯录成员查询权限' }],
  ['dingtalk_identity_response_invalid', { statusCode: 502, message: '钉钉返回的企业成员身份无效' }],
  ['dingtalk_member_required', { statusCode: 403, message: '当前钉钉账号不是已配置企业的内部成员' }],
  ['dingtalk_corp_mismatch', { statusCode: 403, message: '当前钉钉账号不属于已配置的企业' }],
  ['dingtalk_token_error', { statusCode: 502, message: '钉钉应用凭证无法签发应用令牌' }],
  ['console_request_failed', { statusCode: 502, message: 'Connector Runtime 暂时无法读取 Console 集成配置' }]
])

type IdentityFetch = (
  url: string,
  options: Record<string, unknown>
) => Promise<IdentityEnvelope>

const fetchIdentity = fetchExternal as unknown as IdentityFetch

function text(value: unknown) {
  return String(value || '').trim()
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function identityExchangeError(error: unknown) {
  const root = record(error)
  const response = record(root.response)
  const cause = record(root.cause)
  const candidates = [root.data, response._data, response.data, cause.data]
  let code = ''
  for (const candidate of candidates) {
    let body: unknown = candidate
    if (typeof body === 'string' && body.length <= 4096) {
      try {
        body = JSON.parse(body)
      } catch {
        body = null
      }
    }
    const envelope = record(body)
    const candidateCode = text(record(envelope.data).error || envelope.error)
    if (/^[a-z][a-z0-9_]{1,96}$/.test(candidateCode)) {
      code = candidateCode
      break
    }
  }
  return {
    code,
    projection: IDENTITY_EXCHANGE_ERRORS.get(code)
  }
}

function configValue(config: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = text(config[name])
    if (value) return value
  }
  return ''
}

function normalizeRuntimeUrl(value: unknown) {
  const raw = text(value).replace(/\/+$/, '')
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) return ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

async function loadDingTalkIdentityIntegration(event: H3Event, integrationCode: string) {
  if (!ALLOWED_IDENTITY_INTEGRATIONS.has(integrationCode)) {
    throw createError({ statusCode: 400, message: '钉钉登录集成不受支持' })
  }
  const integration = await getIntegration(event, integrationCode)
  if (
    !integration
    || integration.status !== 'active'
    || integration.integrationType !== 'dingtalk'
    || (integration.providerCode && integration.providerCode !== 'dingtalk')
  ) {
    throw createError({ statusCode: 503, message: `钉钉登录集成 ${integrationCode} 未启用` })
  }
  const config = record(integration.config)
  const clientId = configValue(config, [
    'oauthClientId',
    'loginClientId',
    'clientId',
    'appId',
    'appKey'
  ])
  if (!clientId) {
    throw createError({ statusCode: 503, message: `${integrationCode} 缺少 OAuth Client ID / AppKey` })
  }
  if (!isPlausibleDingTalkOAuthClientId(clientId)) {
    throw createError({
      statusCode: 503,
      message: `${integrationCode} 的 OAuth Client ID / AppKey 配置无效；请勿填写 AgentId 或 UnifiedAppId`
    })
  }
  if (
    !integration.currentCredential
    || integration.currentCredential.status !== 'active'
    || !await hasActiveIntegrationCredentialBinding(event, integrationCode)
  ) {
    throw createError({ statusCode: 503, message: `${integrationCode} 缺少有效的 Client Secret 凭证` })
  }
  return {
    integrationCode,
    clientId,
    corpId: configValue(config, ['corpId', 'corp_id'])
  }
}

export async function getDingTalkOAuthPublicConfig(event: H3Event) {
  const dedicated = await getIntegration(event, IDENTITY_INTEGRATION_CODE)
  if (dedicated?.status === 'active') {
    return await loadDingTalkIdentityIntegration(event, IDENTITY_INTEGRATION_CODE)
  }
  return await loadDingTalkIdentityIntegration(event, DEFAULT_INTEGRATION_CODE)
}

export async function getDingTalkUserByCode(
  codeValue: unknown,
  event: H3Event,
  integrationCodeValue?: unknown
): Promise<{ userid: string }> {
  const code = text(codeValue)
  if (!code || code.length > 512) {
    throw createError({ statusCode: 400, message: '钉钉授权码无效' })
  }
  const enabled = text(await getSystemParameter('connector.dingtalkIdentityEnabled').catch(() => null)).toLowerCase() === 'true'
  if (!enabled) {
    throw createError({ statusCode: 503, message: '企业连接运行时钉钉身份能力尚未启用' })
  }
  // Transactions issued before the integration binding column existed always
  // used dingtalk.default. Never re-resolve those callbacks to a new credential.
  const integrationCode = text(integrationCodeValue) || DEFAULT_INTEGRATION_CODE
  await loadDingTalkIdentityIntegration(event, integrationCode)
  const runtimeUrl = normalizeRuntimeUrl(await getSystemParameter('connector.runtimeApiUrl').catch(() => null))
  if (!runtimeUrl) {
    throw createError({ statusCode: 503, message: '企业连接运行时地址未配置或不安全' })
  }
  const token = await requestServiceAccessToken({ event, audience: 'connector-runtime', scope: IDENTITY_SCOPE })
  let response: IdentityEnvelope
  try {
    response = await fetchIdentity(`${runtimeUrl}/v1/identity/dingtalk/exchange`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
      body: { integrationCode, authorizationCode: code }
    })
  } catch (error: unknown) {
    const failure = identityExchangeError(error)
    console.error('[DingTalk Identity] Exchange failed:', failure.code || 'unclassified')
    if (failure.projection) {
      throw createError({
        statusCode: failure.projection.statusCode,
        message: failure.projection.message,
        data: { code: failure.code }
      })
    }
    throw createError({
      statusCode: 502,
      message: '钉钉身份交换失败，请重试',
      data: { code: 'dingtalk_identity_exchange_failed' }
    })
  }
  const userid = text(response.data?.subject?.id)
  if (
    response.code !== 0
    || response.data?.provider !== 'dingtalk'
    || response.data?.integrationCode !== integrationCode
    || response.data?.subject?.kind !== 'member'
    || !userid
    || userid.length > 255
    || /[\r\n\0]/.test(userid)
  ) {
    throw createError({ statusCode: 502, message: '企业连接运行时返回了无效钉钉身份' })
  }
  return { userid }
}
