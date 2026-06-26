/**
 * 企业微信 OAuth 工具
 */
import {
  getWecomIntegrationAccessToken,
  getWecomIntegrationConfig,
  getWecomOAuthIntegrationConfig
} from '@hzy/foundation/server/utils/wecomIntegration'

interface WecomOAuthConfig {
  corpid: string
  agentid: string
}

export async function getWecomOAuthConfig(): Promise<WecomOAuthConfig> {
  const { corpid, agentid } = await getWecomOAuthIntegrationConfig()
  return { corpid, agentid }
}

export async function getWecomAccessToken(): Promise<string> {
  return await getWecomIntegrationAccessToken()
}

export async function getWecomUserByCode(code: string): Promise<{ userid: string }> {
  const config = await getWecomIntegrationConfig()
  const token = await getWecomAccessToken()
  const url = `${config.baseUrl}/cgi-bin/auth/getuserinfo?access_token=${token}&code=${encodeURIComponent(code)}`

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
  const config = await getWecomIntegrationConfig()
  const token = await getWecomAccessToken()
  const url = `${config.baseUrl}/cgi-bin/user/get?access_token=${token}&userid=${encodeURIComponent(userid)}`

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
