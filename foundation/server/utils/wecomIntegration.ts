import { createError } from 'h3'
import { getIntegrationConfig } from './integrationConfig'
import { maybeCallTenantRuntime } from './tenantRuntimeClient'

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function configValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key]
    if (value !== undefined && value !== null && stringValue(value)) {
      return stringValue(value)
    }
  }
  return ''
}

export async function getWecomOAuthIntegrationConfig(integrationCode = 'wecom.default') {
  const integration = await getIntegrationConfig<Record<string, unknown>>(integrationCode)
  const corpid = configValue(integration.config, ['corpid', 'corpId'])
  const agentid = configValue(integration.config, ['agentid', 'agentId'])
  if (!corpid || !agentid) {
    throw createError({ statusCode: 409, message: `Integration ${integrationCode} is missing corpid or agentid` })
  }
  return {
    integrationCode,
    baseUrl: trimSlash(integration.baseUrl || 'https://qyapi.weixin.qq.com'),
    corpid,
    agentid,
    config: integration.config
  }
}

async function callWeComFixedOperation<T>(
  operation: 'oauth-user' | 'user-detail',
  body: Record<string, unknown>,
  integrationCode = 'wecom.default'
) {
  const event = useEvent()
  if (!event) {
    throw createError({
      statusCode: 503,
      message: 'WeCom fixed operation requires a request-bound service identity'
    })
  }
  const runtime = await maybeCallTenantRuntime<{
    code: number
    data: T
  }>(
    event,
    `/v1/console/service/integrations/${encodeURIComponent(integrationCode)}/wecom/${operation}`,
    {
      appCode: 'console',
      scope: 'integration_operations:execute',
      serviceTokenSourceBinding: 'service-client-policy',
      method: 'POST',
      body
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Console Tenant Runtime is required for WeCom operations'
    })
  }
  return runtime.data.data
}

export async function getWecomOAuthUser(code: string, integrationCode = 'wecom.default') {
  return await callWeComFixedOperation<{ userid: string }>(
    'oauth-user',
    { code },
    integrationCode
  )
}

export async function getWecomUserProfile(userid: string, integrationCode = 'wecom.default') {
  return await callWeComFixedOperation<{
    userid: string
    name: string
    email: string
    bizMail: string
    mobile: string
    avatar: string
  }>(
    'user-detail',
    { userid },
    integrationCode
  )
}
