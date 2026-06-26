import { createError } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from './db'

const DEFAULT_CALENDAR_CODE = 'CN'
const DEFAULT_REGION_CODE = 'CN'
const DEFAULT_CALENDAR_NAME = '中国大陆工作日历'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_STANDARD_HOURS_PER_DAY = 8
const DEFAULT_WEEKEND_DAYS = [0, 6]

const DAY_TYPES = new Set([
  'workday',
  'weekend',
  'public_holiday',
  'transfer_workday',
  'custom_holiday',
  'custom_workday'
])

type DbExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

interface WorkCalendarRow extends RowDataPacket {
  id: number
  calendarCode: string
  calendarName: string
  regionCode: string
  timezone: string
  standardHoursPerDay: string | number
  weekendDaysJson: string | unknown | null
  status: string
  updatedAt: string
}

interface WorkCalendarDayRow extends RowDataPacket {
  id: number
  calendarCode: string
  workDate: string
  yearNo: number
  yearMonth: string
  dayOfWeek: number
  dayType: string
  isWorkday: number
  holidayName: string | null
  source: string
  sourceRef: string | null
  importBatch: string | null
  remark: string | null
  updatedAt: string
}

interface WorkCalendarMonthRow extends RowDataPacket {
  id: number
  calendarCode: string
  yearMonth: string
  yearNo: number
  monthNo: number
  workdayCount: number
  nonWorkdayCount: number
  standardHoursPerDay: string | number
  standardWorkHours: string | number
  source: string
  calculatedAt: string
  updatedAt: string
}

interface MonthAggregationRow extends RowDataPacket {
  yearMonth: string
  yearNo: number
  monthNo: number
  workdayCount: number
  nonWorkdayCount: number
  standardHoursPerDay: string | number
}

interface HolidayCalendarDate {
  date?: unknown
  name?: unknown
  name_cn?: unknown
  name_en?: unknown
  type?: unknown
}

interface BuiltCalendarDay {
  workDate: string
  yearNo: number
  yearMonth: string
  monthNo: number
  dayOfWeek: number
  dayType: string
  isWorkday: boolean
  holidayName: string | null
  source: string
  sourceRef: string | null
}

export interface WorkCalendarImportInput {
  calendarCode?: unknown
  calendarName?: unknown
  regionCode?: unknown
  year?: unknown
  mode?: unknown
  dataset?: unknown
  sourceUrl?: unknown
  standardHoursPerDay?: unknown
  requestedBy?: string | null
}

export interface WorkCalendarDayUpdateInput {
  calendarCode?: unknown
  workDate?: unknown
  dayType?: unknown
  isWorkday?: unknown
  holidayName?: unknown
  remark?: unknown
}

function text(value: unknown) {
  return String(value || '').trim()
}

function parseJson(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function assertCalendarCode(value: unknown) {
  const calendarCode = text(value || DEFAULT_CALENDAR_CODE).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(calendarCode)) {
    throw createError({ statusCode: 400, message: 'invalid calendarCode' })
  }
  return calendarCode
}

function assertRegionCode(value: unknown) {
  const regionCode = text(value || DEFAULT_REGION_CODE).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,31}$/.test(regionCode)) {
    throw createError({ statusCode: 400, message: 'invalid regionCode' })
  }
  return regionCode
}

function assertYear(value: unknown) {
  const year = Number(value || new Date().getFullYear())
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createError({ statusCode: 400, message: 'year must be between 2000 and 2100' })
  }
  return year
}

function assertYearMonth(value: unknown) {
  const yearMonth = text(value)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw createError({ statusCode: 400, message: 'yearMonth must be YYYY-MM' })
  }
  return yearMonth
}

function assertDate(value: unknown) {
  const date = text(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, message: 'workDate must be YYYY-MM-DD' })
  }
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw createError({ statusCode: 400, message: 'workDate is invalid' })
  }
  return date
}

function normalizeDayType(value: unknown, isWorkday?: boolean) {
  const dayType = text(value)
  if (dayType) {
    if (!DAY_TYPES.has(dayType)) {
      throw createError({ statusCode: 400, message: 'invalid dayType' })
    }
    return dayType
  }
  return isWorkday ? 'custom_workday' : 'custom_holiday'
}

function dayTypeWorkday(dayType: string) {
  return ['workday', 'transfer_workday', 'custom_workday'].includes(dayType)
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function numberValue(value: unknown, fallback: number) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

function isWorkCalendarSchemaError(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = text(source.code)
  const errno = Number(source.errno || 0)
  const message = error instanceof Error ? error.message : text(source.message)
  return code === 'ER_NO_SUCH_TABLE'
    || code === 'ER_BAD_FIELD_ERROR'
    || errno === 1146
    || errno === 1054
    || (/work_calendar/i.test(message) && /(doesn't exist|unknown column|no such table)/i.test(message))
}

function workCalendarSchemaError() {
  return createError({
    statusCode: 409,
    message: 'Console work calendar schema is not initialized. Run console/docs/work_calendar_incremental.sql on the Console database.'
  })
}

function safeErrorMessage(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = text(source.code)
  const errno = Number(source.errno || 0)
  const message = error instanceof Error ? error.message : text(source.message || 'unknown error')
  const parts = [
    code,
    errno ? `errno ${errno}` : '',
    message
  ].filter(Boolean)
  return parts.join(': ')
}

function workCalendarQueryError(action: string, error: unknown) {
  return createError({
    statusCode: 500,
    message: `Console work calendar ${action} failed: ${safeErrorMessage(error)}`
  })
}

function rethrowWorkCalendarSchemaError(error: unknown): never {
  if (isWorkCalendarSchemaError(error)) {
    throw workCalendarSchemaError()
  }
  throw error
}

function normalizeWeekendDays(value: unknown) {
  const parsed = parseJson(value)
  const values = Array.isArray(parsed) ? parsed : DEFAULT_WEEKEND_DAYS
  const normalized = Array.from(new Set(
    values
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item >= 0 && item <= 6)
  ))
  return normalized.length ? normalized : DEFAULT_WEEKEND_DAYS
}

function mapCalendar(row: WorkCalendarRow) {
  return {
    id: row.id,
    calendarCode: row.calendarCode,
    calendarName: row.calendarName,
    regionCode: row.regionCode,
    timezone: row.timezone,
    standardHoursPerDay: Number(row.standardHoursPerDay || DEFAULT_STANDARD_HOURS_PER_DAY),
    weekendDays: normalizeWeekendDays(row.weekendDaysJson),
    status: row.status,
    updatedAt: row.updatedAt
  }
}

function mapDay(row: WorkCalendarDayRow) {
  return {
    id: row.id,
    calendarCode: row.calendarCode,
    workDate: String(row.workDate).slice(0, 10),
    yearNo: Number(row.yearNo),
    yearMonth: row.yearMonth,
    dayOfWeek: Number(row.dayOfWeek),
    dayType: row.dayType,
    isWorkday: Boolean(row.isWorkday),
    holidayName: row.holidayName,
    source: row.source,
    sourceRef: row.sourceRef,
    importBatch: row.importBatch,
    remark: row.remark,
    updatedAt: row.updatedAt
  }
}

function mapMonth(row: WorkCalendarMonthRow) {
  return {
    id: row.id,
    calendarCode: row.calendarCode,
    yearMonth: row.yearMonth,
    yearNo: Number(row.yearNo),
    monthNo: Number(row.monthNo),
    workdayCount: Number(row.workdayCount || 0),
    nonWorkdayCount: Number(row.nonWorkdayCount || 0),
    standardHoursPerDay: Number(row.standardHoursPerDay || DEFAULT_STANDARD_HOURS_PER_DAY),
    standardWorkHours: Number(row.standardWorkHours || 0),
    source: row.source,
    calculatedAt: row.calculatedAt,
    updatedAt: row.updatedAt
  }
}

async function ensureDefaultCalendar(executor: DbExecutor | null, input: {
  calendarCode?: unknown
  calendarName?: unknown
  regionCode?: unknown
  standardHoursPerDay?: unknown
} = {}) {
  const calendarCode = assertCalendarCode(input.calendarCode)
  const regionCode = assertRegionCode(input.regionCode)
  const hasCalendarName = Boolean(text(input.calendarName))
  const hasRegionCode = input.regionCode !== undefined && input.regionCode !== null && text(input.regionCode) !== ''
  const hasStandardHours = input.standardHoursPerDay !== undefined && input.standardHoursPerDay !== null && text(input.standardHoursPerDay) !== ''
  const hasExplicitUpdate = hasCalendarName || hasRegionCode || hasStandardHours
  const calendarName = text(input.calendarName) || (calendarCode === DEFAULT_CALENDAR_CODE ? DEFAULT_CALENDAR_NAME : `${regionCode} 工作日历`)
  const standardHoursPerDay = numberValue(input.standardHoursPerDay, DEFAULT_STANDARD_HOURS_PER_DAY)
  const db = executor || { queryRows, queryRow, execute }

  await db.execute<ResultSetHeader>(
    `INSERT INTO work_calendars (
       calendar_code,
       calendar_name,
       region_code,
       timezone,
       standard_hours_per_day,
       weekend_days_json,
       status,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       calendar_name = IF(?, VALUES(calendar_name), calendar_name),
       region_code = IF(?, VALUES(region_code), region_code),
       standard_hours_per_day = IF(?, VALUES(standard_hours_per_day), standard_hours_per_day),
       updated_at = IF(?, UTC_TIMESTAMP(), updated_at)`,
    [
      calendarCode,
      calendarName,
      regionCode,
      DEFAULT_TIMEZONE,
      standardHoursPerDay,
      JSON.stringify(DEFAULT_WEEKEND_DAYS),
      hasCalendarName ? 1 : 0,
      hasRegionCode ? 1 : 0,
      hasStandardHours ? 1 : 0,
      hasExplicitUpdate ? 1 : 0
    ]
  )
}

async function getCalendarRow(calendarCode: string, executor: DbExecutor | null = null) {
  const db = executor || { queryRows, queryRow, execute }
  return await db.queryRow<WorkCalendarRow>(
    `SELECT id,
            calendar_code AS calendarCode,
            calendar_name AS calendarName,
            region_code AS regionCode,
            timezone,
            standard_hours_per_day AS standardHoursPerDay,
            weekend_days_json AS weekendDaysJson,
            status,
            updated_at AS updatedAt
       FROM work_calendars
      WHERE calendar_code = ?
      LIMIT 1`,
    [calendarCode]
  )
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

function buildBaseYearDays(yearNo: number, weekendDays: number[]) {
  const days: BuiltCalendarDay[] = []
  let cursor = new Date(Date.UTC(yearNo, 0, 1))
  while (cursor.getUTCFullYear() === yearNo) {
    const workDate = formatDate(cursor)
    const dayOfWeek = cursor.getUTCDay()
    const isWeekend = weekendDays.includes(dayOfWeek)
    days.push({
      workDate,
      yearNo,
      yearMonth: workDate.slice(0, 7),
      monthNo: cursor.getUTCMonth() + 1,
      dayOfWeek,
      dayType: isWeekend ? 'weekend' : 'workday',
      isWorkday: !isWeekend,
      holidayName: null,
      source: 'generated',
      sourceRef: null
    })
    cursor = addDays(cursor, 1)
  }
  return days
}

function extractHolidayDates(dataset: unknown): HolidayCalendarDate[] {
  const parsed = typeof dataset === 'string' ? parseJson(dataset) : dataset
  if (!parsed) return []
  if (Array.isArray(parsed)) return parsed as HolidayCalendarDate[]
  if (typeof parsed === 'object' && Array.isArray((parsed as { dates?: unknown }).dates)) {
    return (parsed as { dates: HolidayCalendarDate[] }).dates
  }
  throw createError({ statusCode: 400, message: 'holiday dataset must contain a dates array' })
}

async function fetchHolidayCalendar(regionCode: string, yearNo: number, sourceUrl?: string) {
  const urls = [
    text(sourceUrl),
    `https://unpkg.com/holiday-calendar/data/${encodeURIComponent(regionCode)}/${yearNo}.json`,
    `https://cdn.jsdelivr.net/gh/cg-zhou/holiday-calendar@main/data/${encodeURIComponent(regionCode)}/${yearNo}.json`
  ].filter(Boolean)

  let lastError = ''
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        lastError = `${url}: ${response.status}`
        continue
      }
      return {
        sourceUrl: url,
        dataset: await response.json()
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  throw createError({ statusCode: 502, message: `holiday-calendar fetch failed: ${lastError || 'unknown error'}` })
}

function mergeHolidayDates(days: BuiltCalendarDay[], holidayDates: HolidayCalendarDate[], source: string, sourceRef: string | null) {
  const byDate = new Map(days.map(day => [day.workDate, day]))

  for (const item of holidayDates) {
    const date = assertDate(item.date)
    const day = byDate.get(date)
    if (!day) continue

    const type = text(item.type)
    if (type === 'public_holiday') {
      day.dayType = 'public_holiday'
      day.isWorkday = false
    } else if (type === 'transfer_workday') {
      day.dayType = 'transfer_workday'
      day.isWorkday = true
    } else {
      continue
    }

    day.holidayName = text(item.name_cn) || text(item.name) || text(item.name_en) || null
    day.source = source
    day.sourceRef = sourceRef
  }
}

async function upsertDay(executor: DbExecutor, calendarCode: string, day: BuiltCalendarDay, importBatch: string | null) {
  await executor.execute<ResultSetHeader>(
    `INSERT INTO work_calendar_days (
       calendar_code,
       work_date,
       year_no,
       \`year_month\`,
       day_of_week,
       day_type,
       is_workday,
       holiday_name,
       source,
       source_ref,
       import_batch,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       year_no = VALUES(year_no),
       \`year_month\` = VALUES(\`year_month\`),
       day_of_week = VALUES(day_of_week),
       day_type = IF(source = 'manual', day_type, VALUES(day_type)),
       is_workday = IF(source = 'manual', is_workday, VALUES(is_workday)),
       holiday_name = IF(source = 'manual', holiday_name, VALUES(holiday_name)),
       source = IF(source = 'manual', source, VALUES(source)),
       source_ref = IF(source = 'manual', source_ref, VALUES(source_ref)),
       import_batch = IF(source = 'manual', import_batch, VALUES(import_batch)),
       updated_at = UTC_TIMESTAMP()`,
    [
      calendarCode,
      day.workDate,
      day.yearNo,
      day.yearMonth,
      day.dayOfWeek,
      day.dayType,
      day.isWorkday ? 1 : 0,
      day.holidayName,
      day.source,
      day.sourceRef,
      importBatch
    ]
  )
}

async function recomputeWorkCalendarMonths(executor: DbExecutor, calendarCode: string, yearNo: number, source: string) {
  const rows = await executor.queryRows<MonthAggregationRow[]>(
    `SELECT d.\`year_month\` AS yearMonth,
            d.year_no AS yearNo,
            CAST(SUBSTRING(d.\`year_month\`, 6, 2) AS UNSIGNED) AS monthNo,
            SUM(CASE WHEN d.is_workday = 1 THEN 1 ELSE 0 END) AS workdayCount,
            SUM(CASE WHEN d.is_workday = 0 THEN 1 ELSE 0 END) AS nonWorkdayCount,
            c.standard_hours_per_day AS standardHoursPerDay
       FROM work_calendar_days d
       INNER JOIN work_calendars c ON c.calendar_code = d.calendar_code
      WHERE d.calendar_code = ?
        AND d.year_no = ?
      GROUP BY d.\`year_month\`, d.year_no, c.standard_hours_per_day
      ORDER BY d.\`year_month\``,
    [calendarCode, yearNo]
  )

  for (const row of rows) {
    const workdayCount = Number(row.workdayCount || 0)
    const standardHoursPerDay = Number(row.standardHoursPerDay || DEFAULT_STANDARD_HOURS_PER_DAY)
    await executor.execute<ResultSetHeader>(
      `INSERT INTO work_calendar_months (
         calendar_code,
         \`year_month\`,
         year_no,
         month_no,
         workday_count,
         non_workday_count,
         standard_hours_per_day,
         standard_work_hours,
         source,
         calculated_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         workday_count = VALUES(workday_count),
         non_workday_count = VALUES(non_workday_count),
         standard_hours_per_day = VALUES(standard_hours_per_day),
         standard_work_hours = VALUES(standard_work_hours),
         source = VALUES(source),
         calculated_at = UTC_TIMESTAMP(),
         updated_at = UTC_TIMESTAMP()`,
      [
        calendarCode,
        row.yearMonth,
        Number(row.yearNo),
        Number(row.monthNo),
        workdayCount,
        Number(row.nonWorkdayCount || 0),
        standardHoursPerDay,
        Number((workdayCount * standardHoursPerDay).toFixed(2)),
        source
      ]
    )
  }
}

export async function listWorkCalendars() {
  try {
    const rows = await queryRows<WorkCalendarRow[]>(
      `SELECT id,
              calendar_code AS calendarCode,
              calendar_name AS calendarName,
              region_code AS regionCode,
              timezone,
              standard_hours_per_day AS standardHoursPerDay,
              weekend_days_json AS weekendDaysJson,
              status,
              updated_at AS updatedAt
         FROM work_calendars
        WHERE status = 'active'
        ORDER BY calendar_code`
    )
    return {
      items: rows.length
        ? rows.map(mapCalendar)
        : [{
            id: 0,
            calendarCode: DEFAULT_CALENDAR_CODE,
            calendarName: DEFAULT_CALENDAR_NAME,
            regionCode: DEFAULT_REGION_CODE,
            timezone: DEFAULT_TIMEZONE,
            standardHoursPerDay: DEFAULT_STANDARD_HOURS_PER_DAY,
            weekendDays: DEFAULT_WEEKEND_DAYS,
            status: 'active',
            updatedAt: ''
          }]
    }
  } catch (error) {
    if (isWorkCalendarSchemaError(error)) throw workCalendarSchemaError()
    throw workCalendarQueryError('list calendars', error)
  }
}

export async function listWorkCalendarMonths(query: Record<string, unknown> = {}) {
  try {
    const calendarCode = assertCalendarCode(query.calendarCode)
    const yearNo = assertYear(query.year)
    const rows = await queryRows<WorkCalendarMonthRow[]>(
      `SELECT id,
              calendar_code AS calendarCode,
              \`year_month\` AS yearMonth,
              year_no AS yearNo,
              month_no AS monthNo,
              workday_count AS workdayCount,
              non_workday_count AS nonWorkdayCount,
              standard_hours_per_day AS standardHoursPerDay,
              standard_work_hours AS standardWorkHours,
              source,
              calculated_at AS calculatedAt,
              updated_at AS updatedAt
         FROM work_calendar_months
        WHERE calendar_code = ?
          AND year_no = ?
        ORDER BY \`year_month\``,
      [calendarCode, yearNo]
    )
    return { items: rows.map(mapMonth) }
  } catch (error) {
    if (isWorkCalendarSchemaError(error)) throw workCalendarSchemaError()
    throw workCalendarQueryError('list months', error)
  }
}

export async function getWorkCalendarMonth(query: Record<string, unknown> = {}) {
  try {
    const calendarCode = assertCalendarCode(query.calendarCode)
    const yearMonth = assertYearMonth(query.yearMonth || query.year_month)
    const row = await queryRow<WorkCalendarMonthRow>(
      `SELECT id,
              calendar_code AS calendarCode,
              \`year_month\` AS yearMonth,
              year_no AS yearNo,
              month_no AS monthNo,
              workday_count AS workdayCount,
              non_workday_count AS nonWorkdayCount,
              standard_hours_per_day AS standardHoursPerDay,
              standard_work_hours AS standardWorkHours,
              source,
              calculated_at AS calculatedAt,
              updated_at AS updatedAt
         FROM work_calendar_months
        WHERE calendar_code = ?
          AND \`year_month\` = ?
        LIMIT 1`,
      [calendarCode, yearMonth]
    )
    if (!row) {
      throw createError({ statusCode: 404, message: `work calendar month not found: ${calendarCode} ${yearMonth}` })
    }
    return mapMonth(row)
  } catch (error) {
    if (isWorkCalendarSchemaError(error)) throw workCalendarSchemaError()
    throw workCalendarQueryError('get month', error)
  }
}

export async function listWorkCalendarDays(query: Record<string, unknown> = {}) {
  try {
    const calendarCode = assertCalendarCode(query.calendarCode)
    const yearMonth = query.yearMonth || query.year_month
      ? assertYearMonth(query.yearMonth || query.year_month)
      : ''
    const yearNo = yearMonth ? Number(yearMonth.slice(0, 4)) : assertYear(query.year)

    const conditions = ['calendar_code = ?', 'year_no = ?']
    const params: unknown[] = [calendarCode, yearNo]
    if (yearMonth) {
      conditions.push('`year_month` = ?')
      params.push(yearMonth)
    }

    const rows = await queryRows<WorkCalendarDayRow[]>(
      `SELECT id,
              calendar_code AS calendarCode,
              work_date AS workDate,
              year_no AS yearNo,
              \`year_month\` AS yearMonth,
              day_of_week AS dayOfWeek,
              day_type AS dayType,
              is_workday AS isWorkday,
              holiday_name AS holidayName,
              source,
              source_ref AS sourceRef,
              import_batch AS importBatch,
              remark,
              updated_at AS updatedAt
         FROM work_calendar_days
        WHERE ${conditions.join(' AND ')}
        ORDER BY work_date`,
      params
    )
    return { items: rows.map(mapDay) }
  } catch (error) {
    if (isWorkCalendarSchemaError(error)) throw workCalendarSchemaError()
    throw workCalendarQueryError('list days', error)
  }
}

export async function importWorkCalendarYear(input: WorkCalendarImportInput) {
  try {
    const calendarCode = assertCalendarCode(input.calendarCode)
    const calendarName = text(input.calendarName)
    const regionCode = assertRegionCode(input.regionCode)
    const yearNo = assertYear(input.year)
    const mode = text(input.mode || 'auto')
    const standardHoursPerDay = numberValue(input.standardHoursPerDay, DEFAULT_STANDARD_HOURS_PER_DAY)

    let dataset = input.dataset
    let sourceUrl: string | null = text(input.sourceUrl) || null
    const source = mode === 'manual' ? 'manual-import' : 'holiday-calendar'

    if (mode !== 'manual') {
      const remote = await fetchHolidayCalendar(regionCode, yearNo, sourceUrl || undefined)
      dataset = remote.dataset
      sourceUrl = remote.sourceUrl
    }

    const holidayDates = extractHolidayDates(dataset).filter(item => text(item.date).startsWith(`${yearNo}-`))
    const importBatch = `wc_${calendarCode}_${yearNo}_${Date.now().toString(36)}`

    await withTransaction(async (tx) => {
      await ensureDefaultCalendar(tx, {
        calendarCode,
        calendarName,
        regionCode,
        standardHoursPerDay
      })
      const calendarRow = await getCalendarRow(calendarCode, tx)
      if (!calendarRow) {
        throw createError({ statusCode: 500, message: 'work calendar not created' })
      }
      const calendar = mapCalendar(calendarRow)
      const days = buildBaseYearDays(yearNo, calendar.weekendDays)
      mergeHolidayDates(days, holidayDates, source, sourceUrl)
      for (const day of days) {
        await upsertDay(tx, calendarCode, day, importBatch)
      }
      await recomputeWorkCalendarMonths(tx, calendarCode, yearNo, source)
      await tx.execute<ResultSetHeader>(
        `INSERT INTO work_calendar_import_jobs (
           job_code,
           calendar_code,
           region_code,
           year_no,
           import_mode,
           source,
           source_url,
           imported_days,
           status,
           message,
           requested_by,
           created_at,
           completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [
          importBatch,
          calendarCode,
          regionCode,
          yearNo,
          mode === 'manual' ? 'manual' : 'auto',
          source,
          sourceUrl,
          holidayDates.length,
          `imported ${holidayDates.length} holiday-calendar dates`,
          input.requestedBy || null
        ]
      )
    })

    const months = await listWorkCalendarMonths({ calendarCode, year: yearNo })
    return {
      calendarCode,
      regionCode,
      year: yearNo,
      source,
      sourceUrl,
      importedDays: holidayDates.length,
      months: months.items
    }
  } catch (error) {
    rethrowWorkCalendarSchemaError(error)
  }
}

export async function updateWorkCalendarDay(input: WorkCalendarDayUpdateInput) {
  try {
    const calendarCode = assertCalendarCode(input.calendarCode)
    const workDate = assertDate(input.workDate)
    const yearNo = Number(workDate.slice(0, 4))
    const yearMonth = workDate.slice(0, 7)
    const parsedDate = new Date(`${workDate}T00:00:00Z`)
    const requestedDayType = text(input.dayType)
    const fallbackType = requestedDayType || (booleanValue(input.isWorkday, true) ? 'custom_workday' : 'custom_holiday')
    const dayType = normalizeDayType(fallbackType)
    const isWorkday = booleanValue(input.isWorkday, dayTypeWorkday(dayType))

    await ensureDefaultCalendar(null, { calendarCode })

    await withTransaction(async (tx) => {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO work_calendar_days (
           calendar_code,
           work_date,
           year_no,
           \`year_month\`,
           day_of_week,
           day_type,
           is_workday,
           holiday_name,
           source,
           remark,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           day_type = VALUES(day_type),
           is_workday = VALUES(is_workday),
           holiday_name = VALUES(holiday_name),
           source = 'manual',
           remark = VALUES(remark),
           updated_at = UTC_TIMESTAMP()`,
        [
          calendarCode,
          workDate,
          yearNo,
          yearMonth,
          parsedDate.getUTCDay(),
          dayType,
          isWorkday ? 1 : 0,
          text(input.holidayName) || null,
          text(input.remark) || null
        ]
      )
      await recomputeWorkCalendarMonths(tx, calendarCode, yearNo, 'manual')
    })

    const dayRows = await listWorkCalendarDays({ calendarCode, yearMonth })
    const day = dayRows.items.find(item => item.workDate === workDate)
    return {
      day,
      month: await getWorkCalendarMonth({ calendarCode, yearMonth })
    }
  } catch (error) {
    rethrowWorkCalendarSchemaError(error)
  }
}
