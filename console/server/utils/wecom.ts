/**
 * 企业微信 OAuth 工具
 */
import type { H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

const WECOM_TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
const WECOM_USERINFO_URL = 'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo'
const WECOM_USER_GET_URL = 'https://qyapi.weixin.qq.com/cgi-bin/user/get'

const cachedTokens = new Map<string, { token: string, expiresAt: number }>()

interface WecomConfig {
  corpid: string
  corpsecret: string
  agentid: string
}

async function getWecomConfig(event?: H3Event): Promise<WecomConfig> {
  if (event) {
    const loginConfig = await resolveConsoleLoginConfig(event)
    if (loginConfig.wecom.corpid && loginConfig.wecom.corpsecret && loginConfig.wecom.agentid) {
      return {
        corpid: loginConfig.wecom.corpid,
        corpsecret: loginConfig.wecom.corpsecret,
        agentid: loginConfig.wecom.agentid
      }
    }
  }

  const config = useRuntimeConfig(event)
  const wecom = config.wecom as WecomConfig
  if (!wecom?.corpid || !wecom?.corpsecret || !wecom?.agentid) {
    throw new Error('[Wecom] Missing WECOM_CORPID, WECOM_CORPSECRET or WECOM_AGENTID')
  }
  return wecom
}

function cacheKey(config: WecomConfig) {
  return createHash('sha256')
    .update(`${config.corpid}:${config.agentid}:${config.corpsecret}`)
    .digest('hex')
}

export async function getWecomAccessToken(event?: H3Event): Promise<string> {
  const config = await getWecomConfig(event)
  const key = cacheKey(config)
  const cachedToken = cachedTokens.get(key)
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }

  const { corpid, corpsecret } = config
  const url = `${WECOM_TOKEN_URL}?corpid=${corpid}&corpsecret=${corpsecret}`

  const res = await $fetch<{
    errcode: number
    errmsg: string
    access_token?: string
    expires_in?: number
  }>(url)

  if (res.errcode !== 0 || !res.access_token) {
    throw new Error(`[Wecom] Failed to get access_token: ${res.errcode} ${res.errmsg}`)
  }

  cachedTokens.set(key, {
    token: res.access_token,
    expiresAt: Date.now() + (res.expires_in! - 300) * 1000
  })

  return res.access_token
}

export async function getWecomUserByCode(code: string, event?: H3Event): Promise<{ userid: string }> {
  const token = await getWecomAccessToken(event)
  const url = `${WECOM_USERINFO_URL}?access_token=${token}&code=${code}`

  const res = await $fetch<{
    errcode: number
    errmsg: string
    userid?: string
  }>(url)

  if (res.errcode !== 0 || !res.userid) {
    throw new Error(`[Wecom] Failed to get user info: ${res.errcode} ${res.errmsg}`)
  }

  return { userid: res.userid }
}

export async function getWecomUserDetail(userid: string, event?: H3Event): Promise<{
  userid: string
  name: string
  email: string
  mobile: string
  avatar: string
}> {
  const token = await getWecomAccessToken(event)
  const url = `${WECOM_USER_GET_URL}?access_token=${token}&userid=${userid}`

  const res = await $fetch<{
    errcode: number
    errmsg: string
    userid?: string
    name?: string
    email?: string
    biz_mail?: string
    mobile?: string
    avatar?: string
  }>(url)

  if (res.errcode !== 0) {
    throw new Error(`[Wecom] Failed to get user detail: ${res.errcode} ${res.errmsg}`)
  }

  return {
    userid: res.userid || userid,
    name: res.name || '',
    email: res.email || res.biz_mail || '',
    mobile: res.mobile || '',
    avatar: res.avatar || ''
  }
}
