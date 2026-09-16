export const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  // 兼容包含 T / 空格分隔，以及可能附带的微秒与时区
  const match = dateStr.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  )
  if (match) {
    return `${match[1]} ${match[2]}`
  }
  // 若不是上述格式，尝试用 Date 解析（可能是其它兼容形式）
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr // 保留原始字符串，方便排查异常格式
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 去除字符串中的“秒后小数部分”（微秒/毫秒），统一保留到秒
// 支持格式：
// - 2025-11-06 22:31:16.999355
// - 2025-11-06T22:31:16.123Z
// - 2025-11-06 22:31:16.5+08:00
export const stripSubseconds = (text: string) =>
  text.replace(
    /(\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\.\d+)((?:Z|[+-]\d{2}:\d{2})?\b)/g,
    '$1$2'
  )

// 规范化日志展示用文本：输入任意值，输出去除小数秒后的字符串
export const sanitizeLogText = (val: unknown) => {
  const s
    = typeof val === 'string' ? val : val == null ? '' : JSON.stringify(val)
  return stripSubseconds(s)
}

export function extractErrorMessage(error: unknown) {
  const err = error as {
    data?: {
      statusMessage?: string
      message?: string
      detail?: string
    }
    statusMessage?: string
    message?: string
  }
  return (
    err?.data?.statusMessage
    || err?.data?.message
    || err?.data?.detail
    || err?.statusMessage
    || err?.message
    || '未知错误'
  )
}

// 将日志 context 友好化展示：对象转为格式化 JSON，字符串做秒级规范化
export function formatLogContext(ctx: unknown): string {
  if (ctx === null || ctx === undefined) return ''
  if (typeof ctx === 'string') {
    // 规范到单行：去掉小数秒并压缩所有空白为单个空格
    return stripSubseconds(ctx).replace(/\s+/g, ' ').trim()
  }
  try {
    // 对象压缩为单行 JSON，再做小数秒规范
    return stripSubseconds(JSON.stringify(ctx)).replace(/\s+/g, ' ').trim()
  } catch {
    return String(ctx)
  }
}
