/** Closed UI projection: never render raw transport/provider messages. */
const reasons: Record<string, string> = {
  external_identity_missing: '收件人未绑定企业微信，已跳过外部通知',
  recipient_inactive: '收件人已停用，已跳过外部通知',
  wecom_send_error: '企业微信拒绝投递，请联系管理员检查',
  insufficient_scope: '通知渠道授权不足，请联系管理员',
  wecom_send_request_failed: '企业微信连接暂不可用，请使用相同请求重试',
  wecom_send_http_error: '企业微信服务暂不可用，请使用相同请求重试'
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
export function documentShareNotificationHint(value: unknown): string {
  const notification = object(object(value).notification)
  return notification.externalStatus === 'skipped' || notification.externalStatus === 'partial_skipped'
    ? reasons[String(notification.reason)] || '外部通知已跳过'
    : ''
}
export function persistedDocumentShareNotification(value: unknown): string | null {
  const outer = object(value), response = object(outer.data), detail = object(response.data)
  const data = detail.sharedPersisted === true ? detail : response
  if (data.sharedPersisted !== true) return null
  return `企业微信通知未送达：${reasons[String(data.notificationReason)] || '通知服务暂不可用，请使用相同请求重试'}`
}
