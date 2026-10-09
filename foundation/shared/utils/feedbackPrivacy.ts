/** Redact before buffering; diagnostics are optional and never persisted locally. */
export function redactFeedbackDiagnostic(input: string) {
  if (input.length > 16_000) return '[错误过长，未采集]'
  return input
    .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw)
        return `${url.origin}${url.pathname}`
      } catch {
        return '[链接已隐藏]'
      }
    })
    .replace(/(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/\S+/gi, '[连接信息已隐藏]')
    .replace(/(?:bearer\s+\S+|(?:password|token|secret|authorization|cookie|api[_-]?key)["']?\s*[:=]\s*["']?[^\s,;}]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi, '[凭据已隐藏]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+|\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b/g, '[个人信息已隐藏]')
}
export function feedbackPageURL(raw: string) {
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

// Current-origin aliases become a relative reference; Runtime resolves it only
// against the tenant's configured public origin. Other origins remain rejected.
export function feedbackSubmissionURL(value: string, browserOrigin: string) {
  try {
    const url = new URL(value, browserOrigin)
    return !url.username && !url.password && url.origin === browserOrigin ? url.pathname : value
  } catch { return value }
}
