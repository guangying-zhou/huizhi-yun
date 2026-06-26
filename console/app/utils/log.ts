export const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const match = dateStr.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  )
  if (match) {
    return `${match[1]} ${match[2]}`
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const stripSubseconds = (text: string) =>
  text.replace(
    /(\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\.\d+)((?:Z|[+-]\d{2}:\d{2})?\b)/g,
    '$1$2'
  )

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
