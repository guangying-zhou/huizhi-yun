/**
 * 企业微信 OAuth 工具
 */

const WECOM_TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
const WECOM_USERINFO_URL = 'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo'
const WECOM_USER_GET_URL = 'https://qyapi.weixin.qq.com/cgi-bin/user/get'

let cachedToken: { token: string, expiresAt: number } | null = null

interface WecomConfig {
  corpid: string
  corpsecret: string
  agentid: string
}

function getWecomConfig(): WecomConfig {
  const config = useRuntimeConfig()
  const wecom = config.wecom as WecomConfig
  if (!wecom?.corpid || !wecom?.corpsecret || !wecom?.agentid) {
    throw new Error('[Wecom] Missing WECOM_CORPID, WECOM_CORPSECRET or WECOM_AGENTID')
  }
  return wecom
}

export async function getWecomAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }

  const { corpid, corpsecret } = getWecomConfig()
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

  cachedToken = {
    token: res.access_token,
    expiresAt: Date.now() + (res.expires_in! - 300) * 1000
  }

  return res.access_token
}

export async function getWecomUserByCode(code: string): Promise<{ userid: string }> {
  const token = await getWecomAccessToken()
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

export async function getWecomUserDetail(userid: string): Promise<{
  userid: string
  name: string
  email: string
  mobile: string
  avatar: string
}> {
  const token = await getWecomAccessToken()
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
