import { createError, type H3Event } from 'h3'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { getDingTalkOAuthPublicConfig } from './dingtalk'
import { getIntegration, hasActiveIntegrationCredentialBinding } from './integrations'
import { getSystemParameter, updateManagedSettingValue } from './systemParameters'

type ConnectorProbeFetch = (
  url: string,
  options: Record<string, unknown>
) => Promise<unknown>

const probeConnector = fetchExternal as unknown as ConnectorProbeFetch

function text(value: unknown) {
  return String(value || '').trim()
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function configValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = text(config[key])
    if (value) return value
  }
  return ''
}

async function requireIdentityProviderIntegration(event: H3Event, provider: 'wecom' | 'dingtalk') {
  if (provider === 'dingtalk') {
    try {
      return await getDingTalkOAuthPublicConfig(event)
    } catch (error) {
      const message = text((error as { message?: unknown })?.message)
      throw createError({
        statusCode: 409,
        message: message || '请先配置并启用 dingtalk.identity，或保留有效的 dingtalk.default 兼容配置'
      })
    }
  }
  const contract = {
    integrationCode: 'wecom.default',
    label: '企业微信',
    credentialLabel: 'CorpSecret'
  }
  const integration = await getIntegration(event, contract.integrationCode)
  if (
    !integration
    || integration.integrationType !== provider
    || (integration.providerCode && integration.providerCode !== provider)
    || integration.status !== 'active'
  ) {
    throw createError({
      statusCode: 409,
      message: `请先在集成中心配置并启用 ${contract.integrationCode}`
    })
  }

  const config = record(integration.config)
  const corpId = configValue(config, ['corpid', 'corpId', 'corp_id'])
  const agentId = Number(configValue(config, ['agentid', 'agentId', 'agent_id']))
  if (!corpId || !Number.isFinite(agentId) || agentId <= 0) {
    throw createError({
      statusCode: 409,
      message: `${contract.integrationCode} 缺少有效的 Corp ID 或 Agent ID`
    })
  }

  if (
    !integration.currentCredential
    || integration.currentCredential.status !== 'active'
    || !await hasActiveIntegrationCredentialBinding(event, contract.integrationCode)
  ) {
    throw createError({
      statusCode: 409,
      message: `请先为 ${contract.integrationCode} 绑定有效的 ${contract.credentialLabel} 凭证`
    })
  }
}

export async function setConnectorNotificationActivation(input: {
  event: H3Event
  enabled: boolean
  actorId: string
}) {
  if (!input.enabled) {
    await updateManagedSettingValue({
      event: input.event,
      settingKey: 'connector.notificationsEnabled',
      value: false,
      updatedBy: input.actorId
    })
    return { enabled: false, checkedAt: new Date().toISOString() }
  }

  const runtimeUrl = text(await getSystemParameter('connector.runtimeApiUrl').catch(() => null)).replace(/\/+$/, '')
  if (!runtimeUrl) {
    throw createError({ statusCode: 409, message: '请先配置 Enterprise Connector Runtime 地址' })
  }
  let health: unknown
  let capabilities: unknown
  try {
    [health, capabilities] = await Promise.all([
      probeConnector(`${runtimeUrl}/runtime/health`, { timeout: 10000 }),
      probeConnector(`${runtimeUrl}/runtime/capabilities`, { timeout: 10000 })
    ])
  } catch {
    throw createError({ statusCode: 503, message: 'Enterprise Connector Runtime 健康检查失败' })
  }
  const healthData = record(record(health).data)
  const capabilityData = record(record(capabilities).data)
  const activeCapabilities = Array.isArray(capabilityData.capabilities)
    ? capabilityData.capabilities.map(record)
    : []
  const notification = activeCapabilities.find(item => item.code === 'notifications.send' && item.version === 'v1')
  if (
    healthData.runtimeProduct !== 'hzy-connector-runtime'
    || capabilityData.schemaVersion !== 'hzy.connector-capabilities.v1'
    || capabilityData.arbitraryHttpProxy !== false
    || notification?.requiredScope !== 'connector-runtime:notifications:send'
    || notification?.path !== '/v1/notifications/send'
  ) {
    throw createError({ statusCode: 409, message: '目标服务不满足 Connector Runtime 通知兼容契约' })
  }
  await updateManagedSettingValue({
    event: input.event,
    settingKey: 'connector.notificationsEnabled',
    value: true,
    updatedBy: input.actorId
  })
  return {
    enabled: true,
    runtimeUrl,
    version: text(healthData.version),
    checkedAt: new Date().toISOString()
  }
}

export async function setConnectorIdentityActivation(input: {
  event: H3Event
  enabled: boolean
  actorId: string
  provider?: 'wecom' | 'dingtalk'
}) {
  const provider = input.provider || 'wecom'
  const contract = provider === 'dingtalk'
    ? {
        settingKey: 'connector.dingtalkIdentityEnabled',
        code: 'identity.dingtalk.exchange',
        scope: 'connector-runtime:identity:dingtalk:exchange',
        path: '/v1/identity/dingtalk/exchange',
        label: '钉钉'
      }
    : {
        settingKey: 'connector.identityEnabled',
        code: 'identity.wecom.browser-login',
        scope: 'connector-runtime:identity:exchange',
        path: '/v1/identity/wecom/authorizations',
        label: '企业微信'
      }
  if (!input.enabled) {
    await updateManagedSettingValue({
      event: input.event,
      settingKey: contract.settingKey,
      value: false,
      updatedBy: input.actorId
    })
    return { enabled: false, checkedAt: new Date().toISOString() }
  }
  await requireIdentityProviderIntegration(input.event, provider)
  const runtimeUrl = text(await getSystemParameter('connector.runtimeApiUrl').catch(() => null)).replace(/\/+$/, '')
  if (!runtimeUrl) {
    throw createError({ statusCode: 409, message: '请先配置 Enterprise Connector Runtime 地址' })
  }
  let health: unknown
  let capabilities: unknown
  try {
    [health, capabilities] = await Promise.all([
      probeConnector(`${runtimeUrl}/runtime/health`, { timeout: 10000 }),
      probeConnector(`${runtimeUrl}/runtime/capabilities`, { timeout: 10000 })
    ])
  } catch {
    throw createError({ statusCode: 503, message: 'Enterprise Connector Runtime 健康检查失败' })
  }
  const healthData = record(record(health).data)
  const capabilityData = record(record(capabilities).data)
  const activeCapabilities = Array.isArray(capabilityData.capabilities)
    ? capabilityData.capabilities.map(record)
    : []
  const identity = activeCapabilities.find(item => item.code === contract.code && item.version === 'v1')
  if (
    healthData.runtimeProduct !== 'hzy-connector-runtime'
    || capabilityData.schemaVersion !== 'hzy.connector-capabilities.v1'
    || capabilityData.arbitraryHttpProxy !== false
    || identity?.requiredScope !== contract.scope
    || identity?.method !== 'POST'
    || identity?.path !== contract.path
  ) {
    throw createError({ statusCode: 409, message: `目标服务不满足 Connector Runtime ${contract.label}身份契约` })
  }
  await updateManagedSettingValue({
    event: input.event,
    settingKey: contract.settingKey,
    value: true,
    updatedBy: input.actorId
  })
  return {
    enabled: true,
    runtimeUrl,
    version: text(healthData.version),
    checkedAt: new Date().toISOString()
  }
}
