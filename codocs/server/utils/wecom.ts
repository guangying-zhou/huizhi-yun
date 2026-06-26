/**
 * 企业微信 OAuth 工具
 * 用于企业微信内免登录：通过 OAuth2 获取用户身份
 */
import {
  getWecomIntegrationAccessToken,
  getWecomIntegrationConfig,
  getWecomOAuthIntegrationConfig
} from '@hzy/foundation/server/utils/wecomIntegration'

/**
 * 获取 access_token（带内存缓存）
 */
export async function getWecomAccessToken(): Promise<string> {
  return await getWecomIntegrationAccessToken()
}

/**
 * 通过 OAuth2 code 获取企业微信用户身份（userid）
 */
export async function getWecomUserByCode(code: string): Promise<{ userid: string }> {
  const config = await getWecomIntegrationConfig()
  const token = await getWecomAccessToken()
  const url = `${config.baseUrl}/cgi-bin/auth/getuserinfo?access_token=${token}&code=${encodeURIComponent(code)}`

  const res = await $fetch<{
    errcode: number
    errmsg: string
    userid?: string
    user_ticket?: string
  }>(url)

  if (res.errcode !== 0 || !res.userid) {
    throw new Error(`[Wecom] Failed to get user info: ${res.errcode} ${res.errmsg}`)
  }

  return { userid: res.userid }
}

/**
 * 通过 userid 获取用户详情（含邮箱）
 */
export async function getWecomUserDetail(userid: string): Promise<{
  userid: string
  name: string
  email: string
  bizMail: string
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
    email: res.email || '',
    bizMail: res.biz_mail || '',
    mobile: res.mobile || '',
    avatar: res.avatar || ''
  }
}

/**
 * 构建企业微信 OAuth2 授权 URL
 */
export async function buildWecomOAuthUrl(redirectUri: string, state: string): Promise<string> {
  const { corpid, agentid } = await getWecomOAuthIntegrationConfig()
  const encoded = encodeURIComponent(redirectUri)
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${corpid}&redirect_uri=${encoded}&response_type=code&scope=snsapi_privateinfo&agentid=${agentid}&state=${encodeURIComponent(state)}#wechat_redirect`
}
