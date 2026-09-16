/**
 * 企业微信消息发送工具
 *
 * 从 wecomsg 项目移植，提供：
 * - Access Token 自动获取与缓存
 * - 多种消息类型构建 (text / markdown / textcard / news / image / file / voice / video)
 * - Token 失效自动重试
 */

// ============================================================
// 类型定义
// ============================================================

// ============================================================
// JSSDK 签名（用于前端 wx.config / wx.agentConfig）
// ============================================================

import { createHash } from 'crypto'

export interface WecomMessageRequest {
  touser?: string
  toparty?: string
  totag?: string
  msgtype: 'text' | 'markdown' | 'textcard' | 'image' | 'news' | 'file' | 'voice' | 'video'
  content?: string
  title?: string
  description?: string
  url?: string
  btntxt?: string
  picurl?: string
  media_id?: string
  articles?: Array<{
    title: string
    description?: string
    url: string
    picurl?: string
  }>
  safe?: number
}

interface WecomApiResponse {
  errcode: number
  errmsg: string
  msgid?: string
  access_token?: string
  expires_in?: number
}

// ============================================================
// Token 缓存（应用 Token + 通讯录 Token 分开缓存）
// ============================================================

interface TokenCacheEntry {
  access_token: string | null
  expires_at: number
}

const tokenCaches: Record<string, TokenCacheEntry> = {}

// ============================================================
// 核心函数
// ============================================================

/**
 * 获取企业微信配置
 */
function getWecomConfig() {
  const config = useRuntimeConfig()
  return {
    corpId: config.wecom.corpId,
    corpSecret: config.wecom.corpSecret,
    agentId: config.wecom.agentId,
    contactSecret: config.wecom.contactSecret
  }
}

/**
 * 检查企业微信是否已配置
 */
export function isWecomConfigured(): boolean {
  const { corpId, corpSecret, agentId } = getWecomConfig()
  return Boolean(corpId && corpSecret && agentId)
}

/**
 * 检查通讯录同步是否已配置
 */
export function isContactSyncConfigured(): boolean {
  const { corpId, contactSecret } = getWecomConfig()
  return Boolean(corpId && contactSecret)
}

/**
 * 获取 Access Token（自动缓存）
 * @param type 'app' 用应用 Secret（发消息），'contact' 用通讯录 Secret（读取完整用户信息）
 */
async function getAccessToken(type: 'app' | 'contact' = 'app'): Promise<string> {
  const cache = tokenCaches[type]
  if (cache?.access_token && cache.expires_at > Date.now()) {
    return cache.access_token
  }

  const { corpId, corpSecret, contactSecret } = getWecomConfig()
  const secret = type === 'contact' ? contactSecret : corpSecret

  if (!corpId || !secret) {
    throw new Error(`缺少企业微信配置 (WECOM_CORPID / ${type === 'contact' ? 'WECOM_CONTACT_SECRET' : 'WECOM_CORPSECRET'})`)
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`
  const result = await $fetch<WecomApiResponse>(url)

  if (result.errcode !== 0) {
    throw new Error(`获取 ${type} token 失败: ${result.errcode} - ${result.errmsg}`)
  }

  tokenCaches[type] = {
    access_token: result.access_token!,
    expires_at: Date.now() + (result.expires_in! - 300) * 1000
  }

  return result.access_token!
}

/**
 * 清除 Token 缓存（用于 token 失效时重试）
 */
function clearTokenCache(type: 'app' | 'contact' = 'app') {
  tokenCaches[type] = { access_token: null, expires_at: 0 }
}

/**
 * 构建企业微信消息体
 */
function buildMessage(body: WecomMessageRequest, agentId: number): Record<string, unknown> {
  const base = {
    touser: body.touser,
    toparty: body.toparty,
    totag: body.totag,
    agentid: agentId,
    safe: body.safe || 0
  }

  switch (body.msgtype) {
    case 'text':
      return { ...base, msgtype: 'text', text: { content: body.content } }
    case 'markdown':
      return { ...base, msgtype: 'markdown', markdown: { content: body.content } }
    case 'textcard':
      return {
        ...base,
        msgtype: 'textcard',
        textcard: {
          title: body.title,
          description: body.description,
          url: body.url,
          btntxt: body.btntxt
        }
      }
    case 'image':
      return { ...base, msgtype: 'image', image: { media_id: body.media_id } }
    case 'news':
      return {
        ...base,
        msgtype: 'news',
        news: {
          articles: body.articles || [{
            title: body.title,
            description: body.description,
            url: body.url,
            picurl: body.picurl
          }]
        }
      }
    case 'file':
      return { ...base, msgtype: 'file', file: { media_id: body.media_id } }
    case 'voice':
      return { ...base, msgtype: 'voice', voice: { media_id: body.media_id } }
    case 'video':
      return {
        ...base,
        msgtype: 'video',
        video: {
          media_id: body.media_id,
          title: body.title,
          description: body.description
        }
      }
    default:
      throw new Error(`不支持的消息类型: ${body.msgtype}`)
  }
}

// ============================================================
// 通讯录查询
// ============================================================

interface WecomDeptUser {
  userid: string
  name: string
  mobile?: string
  email?: string
  biz_mail?: string // 企业邮箱
  avatar?: string // 头像 URL
  thumb_avatar?: string // 缩略头像 URL
  department?: number[]
  status?: number // 1=已激活 2=已禁用 4=未关注 5=退出
}

interface WecomUserListResponse {
  errcode: number
  errmsg: string
  userlist?: WecomDeptUser[]
}

/**
 * 获取企业微信部门成员详情（递归获取所有子部门）
 * department_id=1 为根部门
 */
export async function fetchWecomUsers(departmentId = 1): Promise<WecomDeptUser[]> {
  // 优先用通讯录 Secret（能获取完整字段），fallback 到应用 Secret
  const tokenType = isContactSyncConfigured() ? 'contact' : 'app'
  const accessToken = await getAccessToken(tokenType)
  const url = `https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${accessToken}&department_id=${departmentId}&fetch_child=1`

  const result = await $fetch<WecomUserListResponse>(url)

  if (result.errcode !== 0) {
    throw new Error(`获取企业微信用户列表失败: ${result.errcode} - ${result.errmsg}`)
  }

  return result.userlist || []
}

interface WecomUserGetResponse {
  errcode: number
  errmsg: string
  userid?: string
  name?: string
  biz_mail?: string
  email?: string
  mobile?: string
  avatar?: string
  thumb_avatar?: string
}

/**
 * 获取单个企业微信用户详情（包含 biz_mail）
 */
export async function fetchWecomUserDetail(userid: string): Promise<WecomUserGetResponse> {
  const tokenType = isContactSyncConfigured() ? 'contact' : 'app'
  const accessToken = await getAccessToken(tokenType)
  const url = `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${encodeURIComponent(userid)}`
  return await $fetch<WecomUserGetResponse>(url)
}

/**
 * 验证消息请求参数
 */
export function validateMessageRequest(body: WecomMessageRequest): string | null {
  if (!body.touser && !body.toparty && !body.totag) {
    return '必须指定 touser、toparty 或 totag 中的至少一个'
  }
  if (!body.msgtype) {
    return '必须指定 msgtype'
  }

  const contentTypes = ['text', 'markdown']
  if (contentTypes.includes(body.msgtype) && !body.content) {
    return `${body.msgtype} 类型必须指定 content`
  }

  const titleTypes = ['textcard', 'news']
  if (titleTypes.includes(body.msgtype) && !body.title && !body.articles) {
    return `${body.msgtype} 类型必须指定 title`
  }

  const mediaTypes = ['image', 'file', 'voice', 'video']
  if (mediaTypes.includes(body.msgtype) && !body.media_id) {
    return `${body.msgtype} 类型必须指定 media_id`
  }

  return null
}

/**
 * 发送企业微信消息（带 token 失效自动重试）
 */
export async function sendWecomMessage(body: WecomMessageRequest): Promise<{
  success: boolean
  msgid?: string
  error?: string
  errcode?: number
  errmsg?: string
}> {
  const { agentId } = getWecomConfig()

  if (!isWecomConfigured()) {
    return { success: false, error: '企业微信未配置' }
  }

  const message = buildMessage(body, parseInt(agentId))

  // 第一次尝试
  let accessToken = await getAccessToken()
  let url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`
  let result = await $fetch<WecomApiResponse>(url, {
    method: 'POST',
    body: message
  })

  // Token 失效自动重试（errcode 40014 或 42001）
  if (result.errcode === 40014 || result.errcode === 42001) {
    console.warn('[WeCom] Token 失效，正在重新获取...')
    clearTokenCache()
    accessToken = await getAccessToken()
    url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`
    result = await $fetch<WecomApiResponse>(url, {
      method: 'POST',
      body: message
    })
  }

  if (result.errcode === 0) {
    return { success: true, msgid: result.msgid }
  }

  return {
    success: false,
    error: `${result.errcode} - ${result.errmsg}`,
    errcode: result.errcode,
    errmsg: result.errmsg
  }
}

interface TicketCacheEntry {
  ticket: string | null
  expires_at: number
}

const ticketCaches: Record<string, TicketCacheEntry> = {}

/**
 * 获取企业 jsapi_ticket（用于 wx.config）
 */
async function getCorpTicket(): Promise<string> {
  const cache = ticketCaches['corp']
  if (cache?.ticket && cache.expires_at > Date.now()) {
    return cache.ticket
  }

  const accessToken = await getAccessToken()
  const url = `https://qyapi.weixin.qq.com/cgi-bin/get_jsapi_ticket?access_token=${accessToken}`
  const result = await $fetch<{ errcode: number, errmsg: string, ticket?: string, expires_in?: number }>(url)

  if (result.errcode !== 0 || !result.ticket) {
    throw new Error(`获取企业 jsapi_ticket 失败: ${result.errcode} - ${result.errmsg}`)
  }

  ticketCaches['corp'] = {
    ticket: result.ticket,
    expires_at: Date.now() + (result.expires_in! - 300) * 1000
  }

  return result.ticket
}

/**
 * 获取应用 jsapi_ticket（用于 wx.agentConfig）
 */
async function getAgentTicket(): Promise<string> {
  const cache = ticketCaches['agent']
  if (cache?.ticket && cache.expires_at > Date.now()) {
    return cache.ticket
  }

  const accessToken = await getAccessToken()
  const url = `https://qyapi.weixin.qq.com/cgi-bin/ticket/get?access_token=${accessToken}&type=agent_config`
  const result = await $fetch<{ errcode: number, errmsg: string, ticket?: string, expires_in?: number }>(url)

  if (result.errcode !== 0 || !result.ticket) {
    throw new Error(`获取应用 jsapi_ticket 失败: ${result.errcode} - ${result.errmsg}`)
  }

  ticketCaches['agent'] = {
    ticket: result.ticket,
    expires_at: Date.now() + (result.expires_in! - 300) * 1000
  }

  return result.ticket
}

function generateSignature(ticket: string, nonceStr: string, timestamp: number, url: string): string {
  const str = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`
  return createHash('sha1').update(str).digest('hex')
}

/**
 * 获取 JSSDK 配置（含 wx.config 和 wx.agentConfig 所需参数）
 */
export async function getJssdkConfig(pageUrl: string) {
  const { corpId, agentId } = getWecomConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const nonceStr = Math.random().toString(36).substring(2, 15)

  const [corpTicket, agentTicket] = await Promise.all([
    getCorpTicket(),
    getAgentTicket()
  ])

  return {
    corpConfig: {
      corpid: corpId,
      agentid: agentId,
      timestamp,
      nonceStr,
      signature: generateSignature(corpTicket, nonceStr, timestamp, pageUrl)
    },
    agentConfig: {
      corpid: corpId,
      agentid: parseInt(agentId),
      timestamp,
      nonceStr,
      signature: generateSignature(agentTicket, nonceStr, timestamp, pageUrl)
    }
  }
}
