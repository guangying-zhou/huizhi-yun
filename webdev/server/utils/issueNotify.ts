import type { H3Event } from 'h3'

// Issue 状态变更通知：发布到 Console 统一消息中心（best-effort，不阻断主流程）。
// 复用 Foundation publishNotification（audience=notifications, scope=notifications:publish）。

type IssueLike = {
  id?: string
  displayNo?: number
  title?: string
  reporterUid?: string
  state?: string
}

const STATE_TEXT: Record<string, string> = {
  in_progress: '已创建修复任务',
  verifying: '已修复，待你验证',
  resolved: '已解决',
  closed: '已关闭'
}

export async function notifyIssueUpdate(
  event: H3Event,
  issue: IssueLike,
  opts: { eventType: string, summary?: string } = { eventType: 'state_changed' }
) {
  const reporter = String(issue.reporterUid || '').trim()
  if (!reporter) return

  const ref = `#${issue.displayNo ?? issue.id ?? ''}`.trim()
  const stateText = STATE_TEXT[String(issue.state || '')] || '有更新'

  try {
    await publishNotification({
      event,
      sourceAppCode: 'webdev',
      eventType: opts.eventType,
      category: 'issue',
      title: `你反馈的 Issue ${ref} ${stateText}`,
      summary: opts.summary || issue.title,
      bizType: 'webdev_issue',
      bizId: issue.id,
      idempotencyKey: `webdev-issue-${issue.id}-${issue.state || opts.eventType}`,
      recipients: reporter
    })
  } catch (error) {
    console.warn('[webdev] issue notify skipped', error)
  }
}
