export type ConsoleWorkCalendar = {
  calendarCode: string
  calendarName: string
  regionCode: string
  standardHoursPerDay: number
  weekendDays: number[]
  revision: number
  updatedAt: string
}

export type ConsoleWorkCalendarMonth = {
  calendarCode: string
  yearMonth: string
  yearNo: number
  monthNo: number
  workdayCount: number
  nonWorkdayCount: number
  standardHoursPerDay: number
  standardWorkHours: number
  source: string
  calculatedAt: string
}

export type ConsoleWorkCalendarDay = {
  id: number
  calendarCode: string
  workDate: string
  yearMonth: string
  dayOfWeek: number
  dayType: string
  isWorkday: boolean
  holidayName: string | null
  source: string
  remark: string | null
  revision: number
}

export type ConsoleWorkCalendarDayDraft = {
  dayType: string
  isWorkday: boolean
  holidayName: string
  remark: string
}

export type ConsoleWorkCalendarViewMode = 'calendar' | 'list'
