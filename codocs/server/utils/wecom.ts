/**
 * 企业微信 OAuth 工具
 * 用于企业微信内免登录：通过 OAuth2 获取用户身份
 */
import {
  getWecomOAuthIntegrationConfig,
  getWecomOAuthUser,
  getWecomUserProfile
} from '@hzy/foundation/server/utils/wecomIntegration'

/**
 * 通过 OAuth2 code 获取企业微信用户身份（userid）
 */
export async function getWecomUserByCode(code: string): Promise<{ userid: string }> {
  return await getWecomOAuthUser(code)
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
  const res = await getWecomUserProfile(userid)
  return {
    userid: res.userid,
    name: res.name,
    email: res.email,
    bizMail: res.bizMail,
    mobile: res.mobile,
    avatar: res.avatar
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
