import type { H3Event } from 'h3'
import { getRuntimeSetting } from './runtimeSettings'
import { sendNotification } from './notify'

// 反馈通知：收到反馈后，向 Console 系统参数 `feedback.notify.wecomUsers` 配置的企业微信号推送提醒。
// 与 IssueReporter 上报解耦，失败不影响用户提交结果。

const WEBDEV_APP_CODE = 'webdev'

const KIND_LABEL: Record<string, string> = {
  bug: '缺陷',
  feature: '功能建议',
  question: '使用咨询'
}

const SEVERITY_LABEL: Record<string, string> = {
  low: '低',
  mid: '中',
  high: '高'
}

function stringValue(value: unknown) {
  return String(value ?? '').trim()
}

function parseRecipients(raw: string): string[] {
  // 支持中英文逗号 / 分号 / 空白分隔
  return [...new Set(
    raw.split(/[,，;；\s]+/).map(item => item.trim()).filter(Boolean)
  )]
}

function resolveInboxUrl(event: H3Event, fallback: string): string {
  try {
    const base = resolveServiceAppBaseUrl(event, WEBDEV_APP_CODE)
    if (base) return `${base.replace(/\/+$/, '')}/issues`
  } catch {
    // 解析失败时回退到提交页面 URL
  }
  return fallback
}

/**
 * 读取通知企业微信号并发送反馈提醒。
 * @returns 是否实际尝试发送（无配置时为 false）
 */
export async function notifyFeedbackRecipients(event: H3Event, payload: {
  input: Record<string, unknown>
  reporterName: string
  result?: unknown
}): Promise<boolean> {
  let raw = ''
  try {
    raw = stringValue(await getRuntimeSetting<string>('feedback.notify.wecomUsers', '', { ttlMs: 60000 }))
  } catch {
    return false
  }

  const touser = parseRecipients(raw)
  if (!touser.length) return false

  const input = payload.input
  const kind = stringValue(input.kind) || 'bug'
  const severity = stringValue(input.severity)
  const title = stringValue(input.title) || '(无标题)'
  const pageUrl = stringValue(input.pageUrl)
  const created = (payload.result as { data?: Record<string, unknown> })?.data ?? payload.result
  const displayNo = stringValue((created as Record<string, unknown> | undefined)?.displayNo)
    || stringValue((created as Record<string, unknown> | undefined)?.display_no)

  const kindText = KIND_LABEL[kind] || kind
  const severityText = kind === 'bug' && severity ? ` · 严重度 ${SEVERITY_LABEL[severity] || severity}` : ''
  const description = [
    `提交人：${payload.reporterName}`,
    `类型：${kindText}${severityText}`,
    pageUrl ? `来源页面：${pageUrl}` : ''
  ].filter(Boolean).join('\n')

  await sendNotification({
    event,
    touser,
    title: `【新反馈${displayNo ? ` #${displayNo}` : ''}】${title}`,
    description,
    url: resolveInboxUrl(event, pageUrl),
    btntxt: '查看反馈'
  })

  return true
}
