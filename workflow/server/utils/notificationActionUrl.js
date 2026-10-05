export function resolveWorkflowNotificationURL(notification, workflowBaseUrl) {
  const value = String(notification?.url || '').trim()
  if (!value || /[\r\n]/.test(value) || value.startsWith('//')) return ''
  try {
    const parsed = new URL(value, workflowBaseUrl || 'https://workflow.invalid')
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    if (notification?.metadata?.urlFallback === true) {
      return workflowBaseUrl ? new URL(value, workflowBaseUrl).toString() : ''
    }
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? parsed.toString() : value
  } catch {
    return ''
  }
}
