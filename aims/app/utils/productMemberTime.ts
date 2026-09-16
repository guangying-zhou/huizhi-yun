/** Local datetime inputs are wall times, not unique instants during a DST fold. */
export function productMemberLocalTime(instant: string): string {
  const date = new Date(instant)
  if (!Number.isFinite(date.valueOf())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1)
}

export function productMemberInstant(local: string, original?: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(local)
  if (!match || Number(local.slice(0, 4)) < 1000) return null
  const normalized = `${match[1]}:${match[2] || '00'}.${(match[3] || '').padEnd(3, '0')}`
  // Keep the original offset/instant when the user only edits other fields.
  if (original && productMemberLocalTime(original) === normalized) return new Date(original).toISOString()
  const parsed = new Date(normalized)
  // Reject normalized invalid calendar dates and skipped DST wall times.
  if (!Number.isFinite(parsed.valueOf()) || productMemberLocalTime(parsed.toISOString()) !== normalized) return null
  // For a newly entered repeated wall time, Date selects the earlier occurrence.
  // The form displays the resulting UTC instant before submission.
  return parsed.toISOString()
}
