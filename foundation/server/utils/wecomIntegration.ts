import { createError } from 'h3'
import { getIntegrationConfig, getWecomRuntimeConfig } from './integrationConfig'

interface WecomTokenResponse {
  errcode: number
  errmsg: string
  access_token?: string
  expires_in?: number
}

const tokenCache = new Map<string, { token: string, expiresAt: number }>()

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

export async function getWecomIntegrationConfig(integrationCode = 'wecom.default') {
  const runtime = await getWecomRuntimeConfig(integrationCode)
  return {
    integrationCode: runtime.integrationCode,
    baseUrl: trimSlash(runtime.baseUrl || 'https://qyapi.weixin.qq.com'),
    corpid: runtime.corpid,
    agentid: runtime.agentid,
    corpsecret: runtime.corpsecret,
    config: runtime.config,
    secretVersionNo: runtime.secretVersionNo
  }
}

export async function getWecomIntegrationAccessToken(integrationCode = 'wecom.default') {
  const cached = tokenCache.get(integrationCode)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token
  }

  const config = await getWecomIntegrationConfig(integrationCode)
  const params = new URLSearchParams({
    corpid: config.corpid,
    corpsecret: config.corpsecret
  })
  const response = await $fetch<WecomTokenResponse>(`${config.baseUrl}/cgi-bin/gettoken?${params.toString()}`, {
    timeout: 10000
  })
  if (response.errcode !== 0 || !response.access_token) {
    throw createError({
      statusCode: 502,
      message: `WeCom token request failed: ${response.errcode} ${response.errmsg}`
    })
  }

  tokenCache.set(integrationCode, {
    token: response.access_token,
    expiresAt: Date.now() + Math.max(Number(response.expires_in || 7200) - 300, 60) * 1000
  })
  return response.access_token
}
