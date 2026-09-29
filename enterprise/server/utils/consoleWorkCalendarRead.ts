import { createError, getQuery, getRouterParam, type H3Event } from 'h3'

export function consoleWorkCalendarCode(event: H3Event) {
  const code = getRouterParam(event, 'calendarCode') || ''
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(code)) throw createError({ statusCode: 400, message: 'Invalid calendar code' })
  return code
}
export function consoleWorkCalendarQuery(event: H3Event, key?: 'year' | 'yearMonth') {
  const query = getQuery(event)
  if (Object.keys(query).some(item => item !== key)) throw createError({ statusCode: 400, message: 'Unsupported calendar query' })
  if (!key) return {}
  const value = query[key]
  const pattern = key === 'year' ? /^(?:20\d{2}|2100)$/ : /^(?:20\d{2}|2100)-(?:0[1-9]|1[0-2])$/
  if (typeof value !== 'string' || !pattern.test(value)) throw createError({ statusCode: 400, message: 'Invalid calendar period' })
  return { [key]: value }
}
