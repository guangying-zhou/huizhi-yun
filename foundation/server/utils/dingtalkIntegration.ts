import { createError } from 'h3'
import { getDingTalkRuntimeConfig } from './integrationConfig'

interface DingTalkTokenResponse {
  accessToken?: string
  expireIn?: number
}

interface DingTalkLegacyErrorResponse {
  errcode?: number
  errmsg?: string
}

export interface DingTalkReportContent {
  key: string
  value: string
  type?: string
  sort?: string
}

export interface DingTalkReport {
  report_id: string
  template_name: string
  creator_id: string
  creator_name: string
  dept_name: string
  create_time: number
  modified_time: number
  remark: string
  contents: DingTalkReportContent[]
}

interface DingTalkReportListResponse extends DingTalkLegacyErrorResponse {
  result?: {
    data_list?: DingTalkReport[]
    list?: DingTalkReport[]
    has_more?: boolean
    next_cursor?: number
  }
}

export interface FetchDingTalkReportsInput {
  userid: string
  startTime: number
  endTime: number
  templateName?: string
  integrationCode?: string
}

const tokenCache = new Map<string, { token: string, expiresAt: number }>()

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function getDingTalkIntegrationConfig(integrationCode = 'dingtalk.default') {
  const runtime = await getDingTalkRuntimeConfig(integrationCode)
  return {
    integrationCode: runtime.integrationCode,
    baseUrl: trimSlash(runtime.baseUrl || 'https://api.dingtalk.com'),
    oapiBaseUrl: trimSlash(stringValue(runtime.config.oapiBaseUrl) || 'https://oapi.dingtalk.com'),
    appId: runtime.appId,
    appSecret: runtime.appSecret,
    config: runtime.config,
    secretVersionNo: runtime.secretVersionNo
  }
}

export async function getDingTalkAccessToken(integrationCode = 'dingtalk.default') {
  const cached = tokenCache.get(integrationCode)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token
  }

  const config = await getDingTalkIntegrationConfig(integrationCode)
  const response = await $fetch<DingTalkTokenResponse>(`${config.baseUrl}/v1.0/oauth2/accessToken`, {
    method: 'POST',
    body: {
      appKey: config.appId,
      appSecret: config.appSecret
    },
    timeout: 10000
  })

  if (!response.accessToken) {
    throw createError({ statusCode: 502, message: 'DingTalk token request did not return accessToken' })
  }

  tokenCache.set(integrationCode, {
    token: response.accessToken,
    expiresAt: Date.now() + Math.max(numberValue(response.expireIn, 7200) - 300, 60) * 1000
  })
  return response.accessToken
}

export async function fetchDingTalkReports(input: FetchDingTalkReportsInput): Promise<DingTalkReport[]> {
  const userid = stringValue(input.userid)
  if (!userid) throw createError({ statusCode: 400, message: 'userid is required' })

  const integrationCode = input.integrationCode || 'dingtalk.default'
  const config = await getDingTalkIntegrationConfig(integrationCode)
  const token = await getDingTalkAccessToken(integrationCode)
  const reports: DingTalkReport[] = []
  let cursor = 0
  let hasMore = true

  while (hasMore) {
    const response = await $fetch<DingTalkReportListResponse>(`${config.oapiBaseUrl}/topapi/report/list`, {
      method: 'POST',
      query: { access_token: token },
      body: {
        userid,
        start_time: input.startTime,
        end_time: input.endTime,
        template_name: input.templateName,
        cursor,
        size: 100
      },
      timeout: 30000
    })

    if (response.errcode !== undefined && response.errcode !== 0) {
      throw createError({
        statusCode: 502,
        message: `DingTalk report request failed: ${response.errcode} ${response.errmsg || ''}`.trim()
      })
    }

    const items = response.result?.data_list || response.result?.list || []
    reports.push(...items)
    hasMore = Boolean(response.result?.has_more)
    cursor = Number(response.result?.next_cursor || 0)
    if (!cursor && hasMore) break
  }

  return reports
}
