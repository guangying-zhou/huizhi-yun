/**
 * 企业微信 OAuth 工具
 */
import {
  getWecomOAuthIntegrationConfig,
  getWecomOAuthUser,
  getWecomUserProfile
} from '@hzy/foundation/server/utils/wecomIntegration'

interface WecomOAuthConfig {
  corpid: string
  agentid: string
}

export async function getWecomOAuthConfig(): Promise<WecomOAuthConfig> {
  const { corpid, agentid } = await getWecomOAuthIntegrationConfig()
  return { corpid, agentid }
}

export async function getWecomUserByCode(code: string): Promise<{ userid: string }> {
  return await getWecomOAuthUser(code)
}

export async function getWecomUserDetail(userid: string): Promise<{
  userid: string
  name: string
  email: string
  mobile: string
  avatar: string
}> {
  const res = await getWecomUserProfile(userid)
  return {
    userid: res.userid,
    name: res.name,
    email: res.email || res.bizMail,
    mobile: res.mobile,
    avatar: res.avatar
  }
}
