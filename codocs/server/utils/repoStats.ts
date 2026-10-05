export interface Range {
  start: string
  end: string
}

export function parseRange(rangeRaw?: string, startRaw?: string, endRaw?: string): Range {
  const range = rangeRaw?.trim()
  const start = startRaw?.trim()
  const end = endRaw?.trim()
  if (start && end) {
    return {
      start: new Date(start).toISOString().slice(0, 19).replace('T', ' '),
      end: new Date(end).toISOString().slice(0, 19).replace('T', ' ')
    }
  }
  const now = new Date()
  const endIso = now.toISOString().slice(0, 19).replace('T', ' ')
  const startDate = new Date(now)
  if (range === 'last_7d') {
    startDate.setUTCDate(startDate.getUTCDate() - 7)
  } else { // default to 30d
    startDate.setUTCDate(startDate.getUTCDate() - 30)
  }
  const startIso = startDate.toISOString().slice(0, 19).replace('T', ' ')
  return { start: startIso, end: endIso }
}
