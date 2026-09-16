export function getDefaultWeeklyReportWeek(now = new Date()) {
  const reportDate = new Date(now)
  if (now.getTime() < getCurrentWeekFridayDeadline(now).getTime()) {
    reportDate.setDate(reportDate.getDate() - 7)
  }

  return {
    date: reportDate,
    year: getISOWeekYear(reportDate),
    week: getISOWeekNumber(reportDate)
  }
}

function getCurrentWeekFridayDeadline(date: Date) {
  const deadline = new Date(date)
  const isoDay = deadline.getDay() || 7
  deadline.setDate(deadline.getDate() + (5 - isoDay))
  deadline.setHours(16, 0, 0, 0)
  return deadline
}

function getISOWeekNumber(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getISOWeekYear(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  return d.getUTCFullYear()
}
