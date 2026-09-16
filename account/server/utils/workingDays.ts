import { queryRows, execute } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface HolidayRow extends RowDataPacket {
  date: Date
  is_off_day: number
}

/**
 * Fetches holiday configuration for a given date range.
 * Returns a Map where key is date string (YYYY-MM-DD) and value is boolean (true=off day, false=work day).
 */
export async function getHolidayMap(start: Date, end: Date): Promise<Map<string, boolean>> {
  const holidayMap = new Map<string, boolean>()

  // Format dates for SQL
  const startDateStr = start.toISOString().split('T')[0]
  const endDateStr = end.toISOString().split('T')[0]

  const sql = `
    SELECT date, is_off_day
    FROM system_holidays
    WHERE date BETWEEN ? AND ?
  `

  // Ensure holidays exist for the requested years
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()
  const years = new Set<number>()
  for (let y = startYear; y <= endYear; y++) {
    years.add(y)
  }

  for (const year of years) {
    await ensureHolidaysForYear(year)
  }

  const rows = await queryRows<HolidayRow[]>(sql, [startDateStr, endDateStr])

  for (const row of rows) {
    // Ensure date is formatted as YYYY-MM-DD
    const dateStr = row.date instanceof Date
      ? row.date.toISOString().split('T')[0] as string
      : String(row.date).split('T')[0] as string

    holidayMap.set(dateStr, row.is_off_day === 1)
  }

  return holidayMap
}

/**
 * Calculates the number of working days between two dates (inclusive).
 * Uses holidayMap to handle statutory holidays and make-up workdays.
 */
export async function calculateWorkingDays(start: Date, end: Date): Promise<number> {
  let workingDays = 0
  const holidayMap = await getHolidayMap(start, end)
  const current = new Date(start)
  // Clone end date to avoid modification issues and set to midnight
  const endDate = new Date(end)
  endDate.setHours(0, 0, 0, 0)
  current.setHours(0, 0, 0, 0)

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0] as string
    const dayOfWeek = current.getDay() // 0 = Sunday, 6 = Saturday

    if (holidayMap.has(dateStr)) {
      // If defined in system_holidays, follow the config
      // is_off_day: true = rest, false = work (make-up day)
      const isOffDay = holidayMap.get(dateStr)
      // is_off_day: true = rest, false = work (make-up day)
      if (isOffDay === false) {
        workingDays++
      }
    } else {
      // Standard weekend logic
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workingDays++
      }
    }

    // Move to next day
    current.setDate(current.getDate() + 1)
  }

  return workingDays
}

/**
 * Checks if holiday data exists for a year, and if not, fetches it from GitHub.
 */
export async function ensureHolidaysForYear(year: number): Promise<{ success: boolean, message: string }> {
  // console.log(`[ensureHolidaysForYear] Checking year ${year}`)
  // Check if we have any data for this year
  const checkSql = 'SELECT 1 FROM system_holidays WHERE year = ? LIMIT 1'
  const rows = await queryRows<RowDataPacket[]>(checkSql, [year])

  if (rows.length > 0) {
    // console.log(`[ensureHolidaysForYear] Data exists for ${year}`)
    return { success: true, message: 'Data already exists' }
  }

  // console.log(`[ensureHolidaysForYear] Fetching holiday data for ${year} from GitHub...`)

  try {
    const url = `https://raw.githubusercontent.com/Natescarlet/holiday-cn/master/${year}.json`
    interface HolidayData {
      days: Array<{
        date: string
        name: string
        isOffDay: boolean
      }>
    }
    const data = await $fetch<HolidayData | string>(url)

    // Handle string response if necessary
    const parsedData = typeof data === 'string' ? (JSON.parse(data) as HolidayData) : data

    if (!parsedData || !parsedData.days) {
      // console.warn(`[ensureHolidaysForYear] No holiday data found for ${year}`)
      return { success: false, message: 'No holiday data found in JSON' }
    }

    // console.log(`[ensureHolidaysForYear] Fetched ${parsedData.days.length} days for ${year}`)

    // Insert data
    const values: (string | number)[] = []
    const placeholders: string[] = []

    for (const day of parsedData.days) {
      placeholders.push('(?, ?, ?, ?)')
      values.push(day.date, day.name, day.isOffDay ? 1 : 0, year)
    }

    if (values.length > 0) {
      const insertSql = `
        INSERT INTO system_holidays (date, name, is_off_day, year)
        VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          is_off_day = VALUES(is_off_day),
          year = VALUES(year)
      `
      await execute(insertSql, values)
      // console.log(`[ensureHolidaysForYear] Synced ${values.length / 4} holiday records for ${year}`)
      return { success: true, message: `Synced ${values.length / 4} records` }
    }

    return { success: false, message: 'No days to insert' }
  } catch (e) {
    console.error(`[ensureHolidaysForYear] Failed to fetch/sync holidays for ${year}:`, e)
    throw e
  }
}
