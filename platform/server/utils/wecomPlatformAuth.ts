import type { H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { createError, getRequestURL } from 'h3'
import { useRuntimeConfig } from '#imports'

const WECOM_TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
const WECOM_USERINFO_URL = 'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo'
const WECOM_USER_GET_URL = 'https://qyapi.weixin.qq.com/cgi-bin/user/get'

const cachedTokens = new Map<string, { token: string, expiresAt: number }>()

export type PlatformWecomConfig = {
  corpid: string
  corpsecret: string
  agentid: string
  redirectUri: string
}

export type WecomUserDetail = {
  userid: string
  name: string
  email: string
  mobile: string
  avatar: string
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function cloudflareEnvValue(name: string) {
  const env = globalThis.__hzyCloudflareEnv as Record<string, unknown> | undefined
  return normalizeString(env?.[name])
}

export function platformWecomConfigValue(value: unknown, envName: string) {
  return normalizeString(value) || normalizeString(process.env[envName]) || cloudflareEnvValue(envName)
}

export function getPlatformWecomConfig(event: H3Event): PlatformWecomConfig {
  const runtimeConfig = useRuntimeConfig(event)
  const authConfig = runtimeConfig.auth || {}
  const config = {
    corpid: platformWecomConfigValue(authConfig.wecomCorpid, 'WECOM_CORPID'),
    corpsecret: platformWecomConfigValue(authConfig.wecomCorpsecret, 'WECOM_CORPSECRET'),
    agentid: platformWecomConfigValue(authConfig.wecomAgentid, 'WECOM_AGENTID'),
    redirectUri: platformWecomConfigValue(authConfig.wecomRedirectUri, 'WECOM_OAUTH_REDIRECT_URI')
  }

  if (!config.corpid || !config.corpsecret || !config.agentid) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: '企业微信登录未配置'
    })
  }

  return config
}

export function buildPlatformWecomRedirectUri(event: H3Event, configuredRedirectUri: unknown) {
  const configured = normalizeString(configuredRedirectUri)
  if (configured) {
    return configured
  }

  const runtimeConfig = useRuntimeConfig(event)
  const serviceUrl = normalizeString(runtimeConfig.public?.serviceUrl)
  if (serviceUrl) {
    return `${serviceUrl.replace(/\/+$/, '')}/api/platform/auth/wecom/callback`
  }

  const url = getRequestURL(event)
  return `${url.origin}/api/platform/auth/wecom/callback`
}

function cacheKey(config: PlatformWecomConfig) {
  return createHash('sha256')
    .update(`${config.corpid}:${config.agentid}:${config.corpsecret}`)
    .digest('hex')
}

async function fetchWecomJson<T extends { errcode?: number, errmsg?: string }>(url: URL) {
  const response = await fetch(url)
  const payload = await response.json().catch(() => ({})) as T

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: payload.errmsg || '企业微信接口请求失败'
    })
  }

  return payload
}

export async function getPlatformWecomAccessToken(config: PlatformWecomConfig) {
  const key = cacheKey(config)
  const cachedToken = cachedTokens.get(key)
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }

  const url = new URL(WECOM_TOKEN_URL)
  url.searchParams.set('corpid', config.corpid)
  url.searchParams.set('corpsecret', config.corpsecret)

  const payload = await fetchWecomJson<{
    errcode: number
    errmsg: string
    access_token?: string
    expires_in?: number
  }>(url)

  if (payload.errcode !== 0 || !payload.access_token) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `企业微信 access_token 获取失败：${payload.errmsg || payload.errcode}`
    })
  }

  cachedTokens.set(key, {
    token: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in || 7200) - 300) * 1000
  })

  return payload.access_token
}

export async function getPlatformWecomUserByCode(code: string, config: PlatformWecomConfig) {
  const token = await getPlatformWecomAccessToken(config)
  const url = new URL(WECOM_USERINFO_URL)
  url.searchParams.set('access_token', token)
  url.searchParams.set('code', code)

  const payload = await fetchWecomJson<{
    errcode: number
    errmsg: string
    userid?: string
  }>(url)

  if (payload.errcode !== 0 || !payload.userid) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `企业微信用户身份获取失败：${payload.errmsg || payload.errcode}`
    })
  }

  return {
    userid: payload.userid
  }
}

export async function getPlatformWecomUserDetail(userid: string, config: PlatformWecomConfig): Promise<WecomUserDetail> {
  const token = await getPlatformWecomAccessToken(config)
  const url = new URL(WECOM_USER_GET_URL)
  url.searchParams.set('access_token', token)
  url.searchParams.set('userid', userid)

  const payload = await fetchWecomJson<{
    errcode: number
    errmsg: string
    userid?: string
    name?: string
    email?: string
    biz_mail?: string
    mobile?: string
    avatar?: string
  }>(url)

  if (payload.errcode !== 0) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `企业微信用户详情获取失败：${payload.errmsg || payload.errcode}`
    })
  }

  return {
    userid: payload.userid || userid,
    name: payload.name || '',
    email: payload.email || payload.biz_mail || '',
    mobile: payload.mobile || '',
    avatar: payload.avatar || ''
  }
}
