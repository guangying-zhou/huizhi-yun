import { optionalReadPagination } from './optionalReadPagination'

export function timeEntryReviewQuery(input: Record<string, unknown>): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    if (!['periodKey', 'page', 'pageSize'].includes(key) || typeof value !== 'string' || !value || value !== value.trim()) throw new Error('Invalid review query')
  }
  const key = input.periodKey
  if (typeof key !== 'string' || !/^(?:19[7-9]\d|[2-9]\d{3})-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(key)) throw new Error('Invalid ISO week')
  const [year, week] = [Number(key.slice(0, 4)), Number(key.slice(6))]
  const dec28 = new Date(Date.UTC(year, 11, 28))
  const day = dec28.getUTCDay() || 7
  dec28.setUTCDate(dec28.getUTCDate() + 4 - day)
  const maxWeek = Math.ceil(((dec28.getTime() - Date.UTC(dec28.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
  if (week > maxWeek) throw new Error('Invalid ISO week')
  optionalReadPagination(input)
  return input as Record<string, string>
}
