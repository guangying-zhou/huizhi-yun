import { createError, getQuery, getRouterParam, type H3Event } from 'h3'

type QueryRule = 'page' | 'pageSize' | 'search' | 'segment' | readonly string[]
export function consoleDirectoryReadQuery(event: H3Event, rules: Record<string, QueryRule>) {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(getQuery(event))) {
    const rule = rules[key]
    if (!rule || typeof value !== 'string') throw createError({ statusCode: 400, message: 'Unsupported directory query parameter' })
    let valid = false
    if (Array.isArray(rule)) valid = rule.includes(value)
    else if (rule === 'page' || rule === 'pageSize') {
      const number = Number(value)
      valid = /^[1-9]\d*$/.test(value) && Number.isSafeInteger(number) && number <= (rule === 'pageSize' ? 100 : 1000000)
    } else if (rule === 'search') valid = Buffer.byteLength(value, 'utf8') <= 100
    else if (rule === 'segment') valid = safeSegment(value)
    if (!valid) throw createError({ statusCode: 400, message: 'Invalid directory query parameter' })
    result[key] = value
  }
  return result
}
function safeSegment(value: string) {
  return /^[A-Za-z0-9_.-]{1,128}$/.test(value) && value !== '.' && value !== '..'
}
export function consoleDirectoryReadParam(event: H3Event, key: string) {
  const value = getRouterParam(event, key)
  if (!value || !safeSegment(value)) throw createError({ statusCode: 400, message: 'Invalid directory parameter' })
  return value
}
