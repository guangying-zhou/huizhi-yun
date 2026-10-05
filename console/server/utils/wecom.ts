import { createError, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { getIntegration } from './integrations'
import { getSystemParameter } from './systemParameters'

const INTEGRATION_CODE = 'wecom.default'
const IDENTITY_SCOPE = 'connector-runtime:identity:exchange'

interface IdentityEnvelope {
  code?: number
  data?: {
    provider?: string
    integrationCode?: string
    subject?: {
      id?: string
      kind?: string
    }
  }
}

interface AuthorizationEnvelope {
  code?: number
  data?: {
    authorizationId?: string
  }
}

type IdentityFetch = (
  url: string,
  options: Record<string, unknown>
) => Promise<IdentityEnvelope>

const fetchIdentity = fetchExternal as unknown as IdentityFetch

function text(value: unknown) {
  return String(value || '').trim()
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
    if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
      return ''
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

async function loadWeComIntegration(event: H3Event) {
  const integration = await getIntegration(event, INTEGRATION_CODE)
  if (
    !integration
    || integration.status !== 'active'
    || integration.integrationType !== 'wecom'
    || (integration.providerCode && integration.providerCode !== 'wecom')
  ) {
    throw createError({ statusCode: 503, message: '企业微信登录集成未启用' })
  }
  return { config: integration.config || {} }
}

export async function getWeComOAuthPublicConfig(event: H3Event) {
  const { config } = await loadWeComIntegration(event)
  const corpid = configValue(config, ['corpid', 'corpId', 'corp_id'])
  const agentid = configValue(config, ['agentid', 'agentId', 'agent_id'])
  if (!corpid || !/^\d+$/.test(agentid)) {
    throw createError({ statusCode: 503, message: '企业微信登录集成缺少 Corp ID 或 Agent ID' })
  }
  return { corpid, agentid }
}

async function connectorIdentityContext(event: H3Event) {
  const identityEnabled = text(await getSystemParameter('connector.identityEnabled').catch(() => null)).toLowerCase() === 'true'
  if (!identityEnabled) {
    throw createError({ statusCode: 503, message: '企业连接运行时身份能力尚未启用' })
  }
  await loadWeComIntegration(event)
  const runtimeUrl = normalizeRuntimeUrl(await getSystemParameter('connector.runtimeApiUrl').catch(() => null))
  if (!runtimeUrl) {
    throw createError({ statusCode: 503, message: '企业连接运行时地址未配置或不安全' })
  }
  const token = await requestServiceAccessToken({
    event,
    audience: 'connector-runtime',
    scope: IDENTITY_SCOPE
  })
  return { runtimeUrl, token }
}

export async function createWeComBrowserAuthorization(stateValue: unknown, event: H3Event): Promise<{ redirectUri: string }> {
  const state = text(stateValue)
  if (!/^hzy_es_[A-Za-z0-9_-]{32,}$/.test(state)) {
    throw createError({ statusCode: 400, message: '企业微信登录状态无效' })
  }
  const { runtimeUrl, token } = await connectorIdentityContext(event)
  let response: AuthorizationEnvelope
  try {
    response = await fetchIdentity(`${runtimeUrl}/v1/identity/wecom/authorizations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
      body: { integrationCode: INTEGRATION_CODE, state }
    }) as AuthorizationEnvelope
  } catch {
    throw createError({ statusCode: 502, message: '企业连接运行时无法创建登录回调' })
  }
  const authorizationId = text(response.data?.authorizationId)
  if (response.code !== 0 || !/^hzy_wa_[A-Za-z0-9_-]{32,}$/.test(authorizationId)) {
    throw createError({ statusCode: 502, message: '企业连接运行时返回了无效登录回调' })
  }
  const callback = new URL(`${runtimeUrl}/v1/identity/wecom/callback`)
  callback.searchParams.set('authorizationId', authorizationId)
  return { redirectUri: callback.toString() }
}

export async function redeemWeComBrowserHandoff(ticketValue: unknown, event: H3Event): Promise<{ userid: string }> {
  const handoffTicket = text(ticketValue)
  if (!/^hzy_wh_[A-Za-z0-9_-]{32,}$/.test(handoffTicket)) {
    throw createError({ statusCode: 400, message: '企业微信登录交接码无效' })
  }
  const { runtimeUrl, token } = await connectorIdentityContext(event)
  let response: IdentityEnvelope
  try {
    response = await fetchIdentity(`${runtimeUrl}/v1/identity/wecom/handoffs/redeem`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
      body: {
        integrationCode: INTEGRATION_CODE,
        handoffTicket
      }
    })
  } catch {
    throw createError({ statusCode: 502, message: '企业微信身份交换失败，请重试' })
  }
  const userid = text(response.data?.subject?.id)
  if (
    response.code !== 0
    || response.data?.provider !== 'wecom'
    || response.data?.integrationCode !== INTEGRATION_CODE
    || response.data?.subject?.kind !== 'member'
    || !userid
    || userid.length > 255
    || /[\r\n\0]/.test(userid)
  ) {
    throw createError({ statusCode: 502, message: '企业连接运行时返回了无效身份' })
  }
  return { userid }
}
