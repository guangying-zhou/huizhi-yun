<script setup lang="ts">
/**
 * 部门日志周报页面
 *
 * 两种模式（页签切换）：
 * 1. 工作日志：按日期查看成员工作日志
 * 2. 工作周报：按周查看部门周报 / 成员个人周报
 *
 * 周报负责人流程：创建 → 编辑 → 提交发布 → [修订 → 编辑 → 重新提交]
 * 当前版本始终为"工作周报"，修订时存档为 V1/V2...
 *
 * 可见性：
 * - readonly_flag=0（草稿/修订中）：仅负责人可见
 * - readonly_flag=1（已提交）：所有人可见
 *
 * 成员查看：
 * - 默认选中部门经理，显示部门周报
 * - 点击成员姓名，查看其个人周报和工作日志
 */

definePageMeta({ layout: 'default' })

usePageTitle('部门日志周报')

interface WeeklyReportItem {
  uuid: string
  title: string
  year: number
  week: number
  owner_uid: string
  readonly_flag: number
  hasRevisions: boolean
}

interface VersionItem {
  uuid: string
  title: string
  versionNum: number
}

interface WeeklyReportListResponse {
  success: boolean
  data?: {
    items: WeeklyReportItem[]
    isDeptHead: boolean
  }
}

interface VersionsResponse {
  success: boolean
  data?: { versions: VersionItem[] }
}

interface DocumentContentResponse {
  success: boolean
  data?: {
    content?: string
    readonly_flag?: number
    [key: string]: unknown
  }
}

interface CreateWeeklyReportResponse {
  success: boolean
  data?: { uuid: string, existed?: boolean }
}

interface DeptTreeNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DeptTreeNode[]
}

interface DeptMember {
  uid: string
  realName: string
}

interface DeptMembersResponse {
  code: number
  data?: {
    managerId: string | null
    managerName: string | null
    leaderId: string | null
    parentManagerId: string | null
    parentLeaderId: string | null
    members: DeptMember[]
  }
}

interface PersonalWeeklyReportItem {
  uuid: string
  title: string
  year: number
  week: number
  owner_uid: string
}

interface PersonalWeeklyReportListResponse {
  success: boolean
  data?: { items: PersonalWeeklyReportItem[] }
}

interface WorklogItem {
  uuid: string
  title: string
  date: string | null
}

interface WorklogListResponse {
  success: boolean
  data?: { items: WorklogItem[] }
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = data.message
      if (typeof message === 'string' && message) return message
    }
  }
  return fallback
}

const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()

const toast = useToast()
const { user, userDeptCode, userRealname } = useAuth()
const { hasPermission } = usePermissions()
const { departmentsCache, setDepartmentsCache } = useUserDepartmentsCache()
const uid = computed(() => user.value || 'user1')
const isAdmin = computed(() => hasPermission('departments', 'admin'))
const deptCode = ref<string>('')
const { panelWidth, panelCollapsed, onResizeStart } = useResizablePanel(320)

// ==================== 页签切换 ====================
type TabMode = 'worklogs' | 'weekly-reports'
const activeTab = ref<TabMode>('worklogs')
const tabItems = [
  { label: '工作日志', value: 'worklogs' as TabMode },
  { label: '工作周报', value: 'weekly-reports' as TabMode }
]

const switchTab = (newTab: TabMode) => {
  if (newTab === activeTab.value) return
  activeTab.value = newTab
  if (newTab === 'worklogs') {
    // 切换到日志模式，初始化日期日历
    const now = new Date()
    logCalendarYear.value = now.getFullYear()
    logCalendarMonth.value = now.getMonth() + 1
    logSelectedDate.value = formatDate(now)
    // 默认选中第一个成员
    if (deptMembers.value.length > 0 && !logSelectedMemberUid.value) {
      logSelectedMemberUid.value = deptMembers.value[0]!.uid
    }
    fetchMemberMonthLogs()
  }
}

// ==================== 部门 ====================
const userDepartments = ref<DeptTreeNode[]>([])

const flatDepartments = computed(() => {
  const result: Array<{ deptCode: string, name: string, icon: string }> = []
  const flatten = (nodes: DeptTreeNode[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) flatten(node.children)
      else result.push({ deptCode: node.deptCode, name: node.name, icon: node.orgType === 'committee' ? 'i-lucide-users' : 'i-lucide-building' })
    }
  }
  flatten(userDepartments.value)
  return result
})

const hasMultipleDepts = computed(() => flatDepartments.value.length > 1)
const currentDeptName = computed(() => flatDepartments.value.find(d => d.deptCode === deptCode.value)?.name || '')

const selectedDept = computed({
  get: () => flatDepartments.value.find(d => d.deptCode === deptCode.value) || undefined,
  set: (dept) => {
    if (dept && dept.deptCode !== deptCode.value) switchDepartment(dept.deptCode)
  }
})

const switchDepartment = async (newDeptCode: string) => {
  if (newDeptCode === deptCode.value) return
  deptCode.value = newDeptCode
  try {
    if (import.meta.client) {
      localStorage.setItem('coworks_dept', newDeptCode)
    }
  } catch { /* ignore */ }
  resetSelection()
  await Promise.all([fetchReports(), fetchDeptMembers()])
  // 自动选中当前周
  const now = new Date()
  calendarYear.value = now.getFullYear()
  calendarMonth.value = now.getMonth() + 1
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  checkSelectedWeek()
}

const resetSelection = () => {
  selectedWeek.value = null
  selectedReport.value = null
  previewContent.value = ''
  weekVersions.value = []
  memberWorkReports.value = []
}

const initDeptCode = async () => {
  if (!user.value) return
  const cachedDepartments = departmentsCache.value
  if (cachedDepartments?.departments?.length) {
    userDepartments.value = cachedDepartments.departments
    let cached: string | null = null
    if (import.meta.client) {
      try {
        cached = localStorage.getItem('coworks_dept')
      } catch { /* ignore */ }
    }
    const isValid = (nodes: DeptTreeNode[], code: string): boolean => {
      for (const n of nodes) {
        if (n.deptCode === code) return true
        if (n.children?.length && isValid(n.children, code)) return true
      }
      return false
    }
    if (cached && isValid(userDepartments.value, cached)) deptCode.value = cached
    else if (cachedDepartments.primaryDeptCode) deptCode.value = cachedDepartments.primaryDeptCode
    else if (userDepartments.value.length > 0) deptCode.value = userDepartments.value[0]?.deptCode ?? ''
  }
  if (deptCode.value) return
  try {
    const response = await $fetch<{ code: number, data: { departments: DeptTreeNode[], primaryDeptCode: string | null } }>('/api/account/user-departments', { params: { uid: user.value } })
    if (response.code === 0 && response.data) {
      userDepartments.value = response.data.departments || []
      setDepartmentsCache({ departments: userDepartments.value, primaryDeptCode: response.data.primaryDeptCode || null })
      let cached: string | null = null
      if (import.meta.client) {
        try {
          cached = localStorage.getItem('coworks_dept')
        } catch { /* ignore */ }
      }
      const isValid = (nodes: DeptTreeNode[], code: string): boolean => {
        for (const n of nodes) {
          if (n.deptCode === code) return true
          if (n.children?.length && isValid(n.children, code)) return true
        }
        return false
      }
      if (cached && isValid(userDepartments.value, cached)) deptCode.value = cached
      else if (response.data.primaryDeptCode) deptCode.value = response.data.primaryDeptCode
      else if (userDepartments.value.length > 0) deptCode.value = userDepartments.value[0]?.deptCode ?? ''
    }
  } catch (error) {
    console.error('[WeeklyReports] Failed to fetch user departments:', error)
  }
  if (!deptCode.value && userDeptCode.value) deptCode.value = userDeptCode.value
}
await initDeptCode()

// ==================== 部门成员 ====================
const deptManagerId = ref<string | null>(null)
const deptManagerName = ref<string | null>(null)
const deptLeaderId = ref<string | null>(null)
const parentManagerId = ref<string | null>(null)
const parentLeaderId = ref<string | null>(null)
const deptMembers = ref<DeptMember[]>([])
const selectedMemberUid = ref<string | null>(null) // null = 查看部门周报（经理视角）

const isViewingMember = computed(() => selectedMemberUid.value !== null && selectedMemberUid.value !== deptManagerId.value)
const selectedMemberName = computed(() => {
  if (!selectedMemberUid.value) return deptManagerName.value || ''
  return deptMembers.value.find(m => m.uid === selectedMemberUid.value)?.realName || selectedMemberUid.value
})
const otherMembers = computed(() => deptMembers.value.filter(m => m.uid !== deptManagerId.value))

const fetchDeptMembers = async () => {
  if (!deptCode.value) return
  try {
    const res = await $fetch<DeptMembersResponse>('/api/account/department-members', {
      params: { deptCode: deptCode.value }
    })
    if (res.code === 0 && res.data) {
      deptManagerId.value = res.data.managerId
      deptManagerName.value = res.data.managerName
      deptLeaderId.value = res.data.leaderId
      parentManagerId.value = res.data.parentManagerId
      parentLeaderId.value = res.data.parentLeaderId
      deptMembers.value = res.data.members
      // 默认选中部门经理
      selectedMemberUid.value = res.data.managerId
    }
  } catch {
    console.warn('[WeeklyReports] Failed to fetch department members')
  }
}

const selectMember = (memberUid: string) => {
  selectedMemberUid.value = memberUid
  // 重置到当前周
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  const now = new Date()
  calendarYear.value = now.getFullYear()
  calendarMonth.value = now.getMonth() + 1
  checkSelectedWeek()
}

// 提醒权限：当前用户是否可以提醒个人上报周报
const canRemindPersonal = computed(() => {
  const u = uid.value
  return u === deptManagerId.value || u === deptLeaderId.value
    || u === parentManagerId.value || u === parentLeaderId.value
})

// 提醒权限：当前用户是否可以提醒部门填报周报
const canRemindDept = computed(() => {
  const u = uid.value
  return u === deptLeaderId.value || u === parentManagerId.value || u === parentLeaderId.value
})

// ==================== 状态 ====================
const isDeptHead = ref(false)
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth() + 1)
const selectedWeek = ref<number | null>(null)
const selectedWeekYear = ref<number>(new Date().getFullYear())
const reportWeeks = ref<Map<string, WeeklyReportItem>>(new Map())

// 当前预览的文档（可以是当前版本或历史存档）
const selectedReport = ref<{ uuid: string, title: string, readonly_flag: number } | null>(null)
// 当前周的 "工作周报"（当前版本）
const currentWeekReport = ref<WeeklyReportItem | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)
const isCreating = ref(false)
const isSubmitting = ref(false)
const showSubmitConfirm = ref(false)
const isRevising = ref(false)
const showReviseConfirm = ref(false)
const weekVersions = ref<VersionItem[]>([])

// 成员工作报告列表（日历下方）
interface WorkReportListItem {
  uuid: string
  title: string
  type: 'dept-weekly' | 'weekly' | 'worklog'
  date?: string | null
}
const memberWorkReports = ref<WorkReportListItem[]>([])
const memberReportsLoading = ref(false)
// 成员个人周报未上报提示
const memberWeeklyMissing = ref(false)

// 当前周报是否已提交
const isSubmitted = computed(() => !!selectedReport.value?.readonly_flag)
// 当前周报是否有修订历史
const hasRevisions = computed(() => currentWeekReport.value?.hasRevisions || weekVersions.value.length > 0)
// 当前周是否正在修订（当前版本可读写 + 有历史存档）
const isBeingRevised = computed(() => {
  return currentWeekReport.value && !currentWeekReport.value.readonly_flag && weekVersions.value.length > 0
})

// ==================== ISO 周 ====================
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  return d.getUTCFullYear()
}

const currentWeekNumber = computed(() => getISOWeekNumber(new Date()))
const currentWeekYear = computed(() => getISOWeekYear(new Date()))
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isFutureDate(date: Date): boolean {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return target.getTime() > today.getTime()
}

/** 获取指定 ISO 周的周一和周日 */
function getWeekRange(year: number, week: number): { monday: Date, sunday: Date } {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1)
  const monday = new Date(week1Monday)
  monday.setDate(week1Monday.getDate() + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { monday, sunday }
}

// ==================== 日历 ====================
interface CalendarWeekRow {
  weekYear: number
  weekNum: number
  days: { date: string, day: number, isCurrentMonth: boolean, isToday: boolean, isFuture: boolean }[]
  hasReport: boolean
  isCurrent: boolean
}

const calendarWeeks = computed<CalendarWeekRow[]>(() => {
  const year = calendarYear.value
  const month = calendarMonth.value - 1
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekDay = firstDay.getDay() || 7
  const calStart = new Date(firstDay)
  calStart.setDate(firstDay.getDate() - (startWeekDay - 1))
  const endWeekDay = lastDay.getDay() || 7
  const calEnd = new Date(lastDay)
  calEnd.setDate(lastDay.getDate() + (7 - endWeekDay))
  const today = formatDate(new Date())
  const weeks: CalendarWeekRow[] = []
  const cursor = new Date(calStart)
  while (cursor <= calEnd) {
    const weekYear = getISOWeekYear(cursor)
    const weekNum = getISOWeekNumber(cursor)
    const days: CalendarWeekRow['days'] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor)
      const dateStr = formatDate(d)
      days.push({ date: dateStr, day: d.getDate(), isCurrentMonth: d.getMonth() === month && d.getFullYear() === year, isToday: dateStr === today, isFuture: isFutureDate(d) })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push({ weekYear, weekNum, days, hasReport: reportWeeks.value.has(`${weekYear}-${weekNum}`), isCurrent: weekYear === currentWeekYear.value && weekNum === currentWeekNumber.value })
  }
  return weeks
})

const monthLabel = computed(() => `${calendarYear.value}年${calendarMonth.value}月`)
const prevMonth = () => {
  if (calendarMonth.value === 1) {
    calendarMonth.value = 12
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}
const nextMonth = () => {
  if (calendarMonth.value === 12) {
    calendarMonth.value = 1
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}
const goThisWeek = () => {
  const now = new Date()
  calendarYear.value = now.getFullYear()
  calendarMonth.value = now.getMonth() + 1
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  checkSelectedWeek()
}
const isWeekSelected = (weekYear: number, weekNum: number) => selectedWeekYear.value === weekYear && selectedWeek.value === weekNum

const selectedWeekLabel = computed(() => {
  if (selectedWeek.value === null) return ''
  const weekStr = String(selectedWeek.value).padStart(2, '0')
  const { monday, sunday } = getWeekRange(selectedWeekYear.value, selectedWeek.value)
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  return `${selectedWeekYear.value}年 第${weekStr}周（${fmt(monday)} ~ ${fmt(sunday)}）`
})

const canCreate = computed(() => {
  if (!isDeptHead.value || selectedWeek.value === null || isViewingMember.value) return false
  const now = new Date()
  if (selectedWeekYear.value < getISOWeekYear(now)) return true
  if (selectedWeekYear.value > getISOWeekYear(now)) return false
  return selectedWeek.value <= getISOWeekNumber(now)
})

// ==================== 数据加载 ====================
const fetchReports = async () => {
  if (!deptCode.value) return
  const yearsToFetch = new Set<number>()
  yearsToFetch.add(calendarYear.value)
  if (calendarMonth.value === 1) yearsToFetch.add(calendarYear.value - 1)
  if (calendarMonth.value === 12) yearsToFetch.add(calendarYear.value + 1)

  const weekMap = new Map<string, WeeklyReportItem>()
  for (const [key, val] of reportWeeks.value) {
    const keyYear = parseInt(key.split('-')[0]!)
    if (!yearsToFetch.has(keyYear)) weekMap.set(key, val)
  }

  for (const yr of yearsToFetch) {
    try {
      const res = await $fetch<WeeklyReportListResponse>('/api/weekly-reports/list', {
        query: { dept_code: deptCode.value, year: yr, viewer: uid.value }
      })
      if (res.success && res.data) {
        isDeptHead.value = res.data.isDeptHead
        res.data.items?.forEach((item) => {
          if (item.week > 0) weekMap.set(`${item.year}-${item.week}`, item)
        })
      }
    } catch { /* ignore */ }
  }
  reportWeeks.value = weekMap
}

const selectWeek = (weekYear: number, weekNum: number) => {
  selectedWeekYear.value = weekYear
  selectedWeek.value = weekNum
  checkSelectedWeek()
}

const checkSelectedWeek = async () => {
  if (selectedWeek.value === null) return
  selectedReport.value = null
  currentWeekReport.value = null
  previewContent.value = ''
  weekVersions.value = []
  memberWorkReports.value = []
  memberWeeklyMissing.value = false

  if (isViewingMember.value) {
    // 查看成员的个人周报和工作日志
    await loadMemberReports()
  } else {
    // 查看部门周报（经理视角）
    const reportKey = `${selectedWeekYear.value}-${selectedWeek.value}`
    const report = reportWeeks.value.get(reportKey)

    if (report) {
      currentWeekReport.value = report
      await loadDocument(report.uuid, report.title)
      await loadVersions()
    } else if (!isDeptHead.value) {
      await loadVersions()
      if (weekVersions.value.length > 0) {
        const latest = weekVersions.value[0]!
        await loadDocument(latest.uuid, latest.title)
      }
    }

    // 加载经理的个人报告列表（日历下方）
    if (selectedMemberUid.value) {
      await loadMemberWorkList(selectedMemberUid.value)
    }
  }
}

/** 加载成员的个人周报和工作日志（非经理视角） */
const loadMemberReports = async () => {
  if (!selectedMemberUid.value || selectedWeek.value === null) return

  previewLoading.value = true
  memberReportsLoading.value = true

  try {
    // 获取成员的个人周报
    const weeklyRes = await $fetch<PersonalWeeklyReportListResponse>('/api/personal-weekly-reports/list', {
      query: { owner: selectedMemberUid.value, year: selectedWeekYear.value }
    })

    const weeklyReport = weeklyRes.data?.items?.find(
      item => item.year === selectedWeekYear.value && item.week === selectedWeek.value
    )

    if (weeklyReport) {
      memberWeeklyMissing.value = false
      await loadDocument(weeklyReport.uuid, weeklyReport.title)
    } else {
      memberWeeklyMissing.value = true
      previewContent.value = ''
      selectedReport.value = null
    }

    // 加载工作日志列表
    await loadMemberWorkList(selectedMemberUid.value)
  } catch {
    toast.add({ title: '加载成员报告失败', color: 'error' })
  } finally {
    previewLoading.value = false
    memberReportsLoading.value = false
  }
}

/** 加载成员的工作报告列表（个人周报 + 工作日志） */
const loadMemberWorkList = async (memberUid: string) => {
  if (selectedWeek.value === null) return
  memberReportsLoading.value = true

  try {
    const reports: WorkReportListItem[] = []
    const { monday, sunday } = getWeekRange(selectedWeekYear.value, selectedWeek.value)

    // 获取个人周报
    const weeklyRes = await $fetch<PersonalWeeklyReportListResponse>('/api/personal-weekly-reports/list', {
      query: { owner: memberUid, year: selectedWeekYear.value }
    })
    const weeklyReport = weeklyRes.data?.items?.find(
      item => item.year === selectedWeekYear.value && item.week === selectedWeek.value
    )
    if (weeklyReport) {
      reports.push({ uuid: weeklyReport.uuid, title: weeklyReport.title, type: 'weekly' })
    }

    // 获取工作日志（可能跨月，需要取两个月）
    const months = new Set<string>()
    months.add(`${monday.getFullYear()}-${monday.getMonth() + 1}`)
    months.add(`${sunday.getFullYear()}-${sunday.getMonth() + 1}`)

    for (const ym of months) {
      const [y, m] = ym.split('-')
      try {
        const logRes = await $fetch<WorklogListResponse>('/api/worklogs/list', {
          query: { owner: memberUid, year: y, month: m }
        })
        if (logRes.data?.items) {
          for (const log of logRes.data.items) {
            if (!log.date) continue
            const logDate = new Date(log.date)
            if (logDate >= monday && logDate <= sunday) {
              reports.push({ uuid: log.uuid, title: log.title, type: 'worklog', date: log.date })
            }
          }
        }
      } catch { /* ignore */ }
    }

    // 如果是经理视角且有部门周报，插到最前面
    if (memberUid === deptManagerId.value && !isViewingMember.value) {
      const reportKey = `${selectedWeekYear.value}-${selectedWeek.value}`
      const deptReport = reportWeeks.value.get(reportKey)
      if (deptReport) {
        reports.unshift({ uuid: deptReport.uuid, title: deptReport.title, type: 'dept-weekly' })
      }
    }

    // 排序：部门周报 > 个人周报 > 日志按日期
    const typeOrder = { 'dept-weekly': 0, 'weekly': 1, 'worklog': 2 }
    reports.sort((a, b) => {
      const orderDiff = typeOrder[a.type] - typeOrder[b.type]
      if (orderDiff !== 0) return orderDiff
      return (a.date || '').localeCompare(b.date || '')
    })

    memberWorkReports.value = reports
  } catch {
    memberWorkReports.value = []
  } finally {
    memberReportsLoading.value = false
  }
}

/** 点击工作报告列表中的项目 */
const selectWorkReport = async (item: WorkReportListItem) => {
  await loadDocument(item.uuid, item.title)
}

const loadDocument = async (uuid: string, title: string) => {
  previewLoading.value = true
  try {
    const docRes = await $fetch<DocumentContentResponse>(`/api/documents/${uuid}`, {
      params: { uid: uid.value }
    })
    if (docRes.success && docRes.data) {
      previewContent.value = docRes.data.content || ''
      selectedReport.value = {
        uuid,
        title,
        readonly_flag: (docRes.data.readonly_flag as number) || 0
      }
    }
  } catch {
    toast.add({ title: '加载文档失败', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

const loadVersions = async () => {
  if (selectedWeek.value === null || !deptCode.value) return
  try {
    const res = await $fetch<VersionsResponse>('/api/weekly-reports/versions', {
      query: { dept_code: deptCode.value, year: selectedWeekYear.value, week: selectedWeek.value }
    })
    weekVersions.value = res.data?.versions || []
  } catch { /* ignore */ }
}

// 负责人切换查看历史版本
const switchToVersion = async (uuid: string) => {
  const version = weekVersions.value.find(v => v.uuid === uuid)
  if (version) {
    await loadDocument(version.uuid, version.title)
  }
}

// 负责人切回当前版本
const switchToCurrent = async () => {
  if (currentWeekReport.value) {
    await loadDocument(currentWeekReport.value.uuid, currentWeekReport.value.title)
  }
}

// 是否正在查看历史版本（而非当前版本）
const isViewingArchive = computed(() => {
  return selectedReport.value && currentWeekReport.value && selectedReport.value.uuid !== currentWeekReport.value.uuid
})

// ==================== 提醒上报 ====================
const showRemindConfirm = ref(false)
const isReminding = ref(false)
const remindType = ref<'dept-report' | 'personal-report'>('personal-report')
const remindTargetUid = ref('')
const remindTargetName = ref('')

const openRemindConfirm = (type: 'dept-report' | 'personal-report', targetUid?: string, targetName?: string) => {
  remindType.value = type
  remindTargetUid.value = targetUid || ''
  remindTargetName.value = targetName || ''
  showRemindConfirm.value = true
}

const sendRemind = async () => {
  if (selectedWeek.value === null) return
  isReminding.value = true
  try {
    await $fetch('/api/weekly-reports/remind', {
      method: 'POST',
      body: {
        type: remindType.value,
        dept_code: deptCode.value,
        dept_name: currentDeptName.value,
        target_uid: remindTargetUid.value || undefined,
        target_name: remindTargetName.value || undefined,
        year: selectedWeekYear.value,
        week: selectedWeek.value
      }
    })
    showRemindConfirm.value = false
    toast.add({ title: '提醒已发送', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '发送提醒失败'), color: 'error' })
  } finally {
    isReminding.value = false
  }
}

// ==================== 操作 ====================
const createReport = async () => {
  if (selectedWeek.value === null || !uid.value || !deptCode.value) return
  isCreating.value = true
  try {
    const res = await $fetch<CreateWeeklyReportResponse>('/api/weekly-reports/create', {
      method: 'POST',
      body: { dept_code: deptCode.value, dept_name: currentDeptName.value, owner_uid: uid.value, owner_realname: userRealname.value || '', year: selectedWeekYear.value, week: selectedWeek.value }
    })
    if (res.success && res.data) {
      await fetchReports()
      navigateTo(`/documents/${res.data.uuid}`)
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建周报失败'), color: 'error' })
  } finally {
    isCreating.value = false
  }
}

const editReport = () => {
  if (selectedReport.value) {
    if (previewContent.value) {
      setDocumentPreviewBootstrap(selectedReport.value.uuid, {
        content: previewContent.value
      })
    }
    navigateTo(`/documents/${selectedReport.value.uuid}`)
  }
}

const submitReport = async () => {
  if (!currentWeekReport.value) return
  isSubmitting.value = true
  try {
    await $fetch('/api/weekly-reports/submit', { method: 'POST', body: { uuid: currentWeekReport.value.uuid } })
    showSubmitConfirm.value = false
    toast.add({ title: '周报已提交，已通知相关人员', color: 'success' })
    await fetchReports()
    await checkSelectedWeek()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '提交失败'), color: 'error' })
  } finally {
    isSubmitting.value = false
  }
}

const reviseReport = async () => {
  if (!currentWeekReport.value) return
  isRevising.value = true
  try {
    await $fetch<{ success: boolean, data?: { uuid: string } }>('/api/weekly-reports/revise', {
      method: 'POST',
      body: { uuid: currentWeekReport.value.uuid }
    })
    showReviseConfirm.value = false
    toast.add({ title: '已创建修订存档，当前周报已恢复为可编辑', color: 'success' })
    await fetchReports()
    if (previewContent.value) {
      setDocumentPreviewBootstrap(currentWeekReport.value.uuid, {
        content: previewContent.value
      })
    }
    navigateTo(`/documents/${currentWeekReport.value.uuid}`)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '修订失败'), color: 'error' })
  } finally {
    isRevising.value = false
  }
}

// ==================== 工作日志模式 ====================
const logCalendarYear = ref(new Date().getFullYear())
const logCalendarMonth = ref(new Date().getMonth() + 1)
const logSelectedDate = ref('')
const logSelectedMemberUid = ref<string | null>(null)
const logMemberDates = ref<Set<string>>(new Set())
const logMonthItems = ref<WorklogItem[]>([])
const logSelectedDoc = ref<{ uuid: string, title: string, readonly_flag?: number } | null>(null)
const logPreviewContent = ref('')
const logPreviewLoading = ref(false)
const logMonthLoading = ref(false)

const logSelectedMemberName = computed(() => {
  if (!logSelectedMemberUid.value) return ''
  return deptMembers.value.find(m => m.uid === logSelectedMemberUid.value)?.realName || ''
})

const logMonthLabel = computed(() => `${logCalendarYear.value}年${logCalendarMonth.value}月`)

const logPrevMonth = () => {
  if (logCalendarMonth.value === 1) {
    logCalendarMonth.value = 12
    logCalendarYear.value--
  } else {
    logCalendarMonth.value--
  }
}

const logNextMonth = () => {
  if (logCalendarMonth.value === 12) {
    logCalendarMonth.value = 1
    logCalendarYear.value++
  } else {
    logCalendarMonth.value++
  }
}

const logGoToday = () => {
  const now = new Date()
  logCalendarYear.value = now.getFullYear()
  logCalendarMonth.value = now.getMonth() + 1
  logSelectedDate.value = formatDate(now)
  checkLogSelectedDate()
}

const logSelectedDateLabel = computed(() => {
  if (!logSelectedDate.value) return ''
  const [y, m, d] = logSelectedDate.value.split('-')
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[new Date(logSelectedDate.value).getDay()]
  return `${y}年${m}月${d}日 星期${weekDay}`
})

// 日志模式的日期日历
const logCalendarWeeks = computed(() => {
  const year = logCalendarYear.value
  const month = logCalendarMonth.value - 1
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekDay = firstDay.getDay() || 7
  const calStart = new Date(firstDay)
  calStart.setDate(firstDay.getDate() - (startWeekDay - 1))
  const endWeekDay = lastDay.getDay() || 7
  const calEnd = new Date(lastDay)
  calEnd.setDate(lastDay.getDate() + (7 - endWeekDay))
  const today = formatDate(new Date())

  const days: { date: string, day: number, isCurrentMonth: boolean, isToday: boolean, isFuture: boolean, hasLog: boolean }[] = []
  const cursor = new Date(calStart)
  while (cursor <= calEnd) {
    const d = new Date(cursor)
    const dateStr = formatDate(d)
    days.push({
      date: dateStr,
      day: d.getDate(),
      isCurrentMonth: d.getMonth() === month && d.getFullYear() === year,
      isToday: dateStr === today,
      isFuture: isFutureDate(d),
      hasLog: logMemberDates.value.has(dateStr)
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  const nowDate = new Date()
  const nowWeekNum = getISOWeekNumber(nowDate)
  const nowWeekYear = getISOWeekYear(nowDate)

  return Array.from({ length: days.length / 7 }, (_, index) => {
    const weekDays = days.slice(index * 7, (index + 1) * 7)
    const anchorDay = weekDays[0]
    if (!anchorDay) return { weekNum: 0, weekYear: year, isCurrent: false, days: [] }
    const anchorDate = new Date(`${anchorDay.date}T00:00:00`)
    const weekNum = getISOWeekNumber(anchorDate)
    const weekYear = getISOWeekYear(anchorDate)
    return {
      weekNum,
      weekYear,
      isCurrent: weekNum === nowWeekNum && weekYear === nowWeekYear,
      days: weekDays
    }
  })
})

const fetchMemberMonthLogs = async () => {
  if (!logSelectedMemberUid.value || !deptCode.value) return
  logMonthLoading.value = true
  try {
    const res = await $fetch<WorklogListResponse>('/api/worklogs/list', {
      query: { owner: logSelectedMemberUid.value, year: logCalendarYear.value, month: logCalendarMonth.value }
    })
    const items = res.data?.items || []
    const dates = new Set<string>()
    items.forEach((item) => {
      if (item.date) dates.add(item.date)
    })
    logMemberDates.value = dates
    logMonthItems.value = items
  } catch {
    logMemberDates.value = new Set()
    logMonthItems.value = []
  } finally {
    logMonthLoading.value = false
  }
}

const selectLogMember = (memberUid: string) => {
  logSelectedMemberUid.value = memberUid
  logSelectedDoc.value = null
  logPreviewContent.value = ''
  fetchMemberMonthLogs()
}

const selectLogDay = (dateStr: string) => {
  logSelectedDate.value = dateStr
  checkLogSelectedDate()
}

const checkLogSelectedDate = async () => {
  if (!logSelectedDate.value || !logSelectedMemberUid.value) return
  logSelectedDoc.value = null
  logPreviewContent.value = ''

  if (logMemberDates.value.has(logSelectedDate.value)) {
    await loadLogDocument()
  }
}

const loadLogDocument = async () => {
  logPreviewLoading.value = true
  try {
    const item = logMonthItems.value.find(i => i.date === logSelectedDate.value)
    if (item) {
      const docRes = await $fetch<DocumentContentResponse>(`/api/documents/${item.uuid}`, {
        params: { uid: uid.value }
      })
      if (docRes.success && docRes.data) {
        logPreviewContent.value = docRes.data.content || ''
        logSelectedDoc.value = {
          uuid: item.uuid,
          title: item.title,
          readonly_flag: (docRes.data.readonly_flag as number) || 0
        }
      }
    }
  } catch {
    toast.add({ title: '加载日志失败', color: 'error' })
  } finally {
    logPreviewLoading.value = false
  }
}

const viewLogDocument = () => {
  if (logSelectedDoc.value) {
    if (logPreviewContent.value) {
      setDocumentPreviewBootstrap(logSelectedDoc.value.uuid, {
        content: logPreviewContent.value
      })
    }
    navigateTo(`/documents/${logSelectedDoc.value.uuid}`)
  }
}

watch([logCalendarYear, logCalendarMonth], () => {
  if (activeTab.value === 'worklogs') {
    fetchMemberMonthLogs()
  }
})

// ==================== 生命周期 ====================
onMounted(async () => {
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  await Promise.all([fetchReports(), fetchDeptMembers()])
  checkSelectedWeek()
})

watch([calendarYear, calendarMonth], () => {
  fetchReports()
})
watch(deptCode, () => {
  fetchReports()
})

// ==================== 钉钉同步 ====================
const isSyncing = ref(false)
const showSyncConfirm = ref(false)

interface SyncResult {
  synced: number
  skipped: number
  errors?: string[]
  message: string
}

const syncDingtalkReports = async () => {
  if (!deptCode.value) return

  isSyncing.value = true
  showSyncConfirm.value = false

  // 使用当前页签对应的年月
  const syncYear = activeTab.value === 'worklogs' ? logCalendarYear.value : calendarYear.value
  const syncMonth = activeTab.value === 'worklogs' ? logCalendarMonth.value : calendarMonth.value

  try {
    const results: SyncResult[] = []

    // 顺序同步日志和周报
    for (const syncType of ['worklog', 'weekly'] as const) {
      const res = await $fetch<{ success: boolean, data?: SyncResult }>('/api/dingtalk/sync-reports', {
        method: 'POST',
        body: {
          dept_code: deptCode.value,
          type: syncType,
          year: syncYear,
          month: syncMonth
        }
      })
      if (res.data) results.push(res.data)
    }

    const total = results.reduce((sum, r) => sum + r.synced, 0)
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0)
    const allErrors = results.flatMap(r => r.errors || [])

    if (total > 0 || totalSkipped > 0) {
      toast.add({
        title: `同步完成：新增 ${total} 篇，跳过 ${totalSkipped} 篇`,
        color: total > 0 ? 'success' : 'info'
      })
    } else if (allErrors.length > 0) {
      toast.add({ title: `同步失败：${allErrors[0]}`, color: 'error' })
    } else {
      toast.add({ title: '无可同步的数据', color: 'info' })
    }

    // 刷新两个模式的数据
    if (activeTab.value === 'worklogs') {
      await fetchMemberMonthLogs()
      checkLogSelectedDate()
    } else {
      await fetchReports()
      checkSelectedWeek()
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '同步钉钉日志失败'), color: 'error' })
  } finally {
    isSyncing.value = false
  }
}

const syncConfirmMonth = computed(() => {
  const y = activeTab.value === 'worklogs' ? logCalendarYear.value : calendarYear.value
  const m = activeTab.value === 'worklogs' ? logCalendarMonth.value : calendarMonth.value
  return `${y}年${m}月`
})

const syncConfirmMessage = computed(() => {
  return `将同步 ${currentDeptName.value || '当前部门'} 全部成员 ${syncConfirmMonth.value} 的钉钉工作日志和周报`
})

const canSync = computed(() => {
  return !!deptCode.value && isAdmin.value
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧面板 -->
      <aside
        v-if="!panelCollapsed"
        class="relative border-r border-default bg-default flex-col p-4 overflow-y-auto hidden md:flex shrink-0"
        :style="{ width: panelWidth + 'px', minWidth: '280px' }"
      >
        <!-- 部门选择 + 同步钉钉 -->
        <div v-if="hasMultipleDepts || canSync" class="mb-3 pb-3 border-b border-default">
          <div class="flex items-center justify-between mb-1">
            <label v-if="hasMultipleDepts" class="text-xs text-muted">选择部门</label>
            <UButton
              v-if="canSync"
              icon="i-lucide-refresh-cw"
              variant="outline"
              color="primary"
              size="xs"
              :loading="isSyncing"
              @click="showSyncConfirm = true"
            >
              同步钉钉
            </UButton>
          </div>
          <USelectMenu
            v-if="hasMultipleDepts"
            v-model="selectedDept"
            :items="flatDepartments"
            label-key="name"
            placeholder="请选择部门"
            size="lg"
            class="w-full"
            :search-input="false"
          >
            <template #leading>
              <UIcon v-if="selectedDept" :name="selectedDept.icon" class="w-4 h-4" />
            </template>
          </USelectMenu>
        </div>

        <!-- 页签切换 -->
        <div class="mb-3 pb-3 border-b border-default">
          <div class="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            <button
              v-for="tab in tabItems"
              :key="tab.value"
              class="flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors text-center"
              :class="activeTab === tab.value
                ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
                : 'text-muted hover:text-default'"
              @click="switchTab(tab.value)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <!-- ===== 工作周报模式 ===== -->
        <template v-if="activeTab === 'weekly-reports'">
          <!-- 部门成员 -->
          <div v-if="deptMembers.length > 0" class="mb-3 pb-3 border-b border-default">
            <!-- 部门经理 -->
            <div v-if="deptManagerId" class="mb-2">
              <span class="text-xs text-muted">部门经理：</span>
              <button
                class="text-xs font-medium px-1.5 py-0.5 rounded transition-colors"
                :class="selectedMemberUid === deptManagerId
                  ? 'bg-primary text-white'
                  : 'text-primary hover:bg-primary/10'"
                @click="selectMember(deptManagerId!)"
              >
                {{ deptManagerName || deptManagerId }}
              </button>
            </div>
            <!-- 部门成员 -->
            <div v-if="otherMembers.length > 0">
              <span class="text-xs text-muted">部门成员：</span>
              <div class="flex flex-wrap gap-1 mt-1">
                <button
                  v-for="member in otherMembers"
                  :key="member.uid"
                  class="text-xs px-1.5 py-0.5 rounded transition-colors"
                  :class="selectedMemberUid === member.uid
                    ? 'bg-primary text-white'
                    : 'text-default hover:bg-gray-100 dark:hover:bg-gray-800'"
                  @click="selectMember(member.uid)"
                >
                  {{ member.realName }}
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-default bg-elevated p-3">
            <!-- 日历导航 -->
            <div class="flex items-center justify-between mb-3">
              <UButton
                icon="i-lucide-chevron-left"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="prevMonth"
              />
              <span class="text-sm font-semibold">{{ monthLabel }}</span>
              <UButton
                icon="i-lucide-chevron-right"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="nextMonth"
              />
            </div>
            <div class="flex justify-center mb-3">
              <UButton
                variant="soft"
                color="primary"
                size="xs"
                @click="goThisWeek"
              >
                本周
              </UButton>
            </div>
            <div class="grid grid-cols-8 text-center text-xs text-muted mb-1">
              <span class="font-medium">W</span>
              <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span>
            </div>
            <div class="space-y-1">
              <div
                v-for="weekRow in calendarWeeks"
                :key="`${weekRow.weekYear}-${weekRow.weekNum}`"
                class="grid grid-cols-8 items-center gap-1"
              >
                <span
                  class="flex items-center justify-center text-[10px] font-semibold"
                  :class="{
                    'text-primary': weekRow.isCurrent,
                    'text-green-600 dark:text-green-400': !isViewingMember && weekRow.hasReport && !weekRow.isCurrent,
                    'text-muted': !weekRow.isCurrent && (isViewingMember || !weekRow.hasReport)
                  }"
                >
                  {{ weekRow.weekNum }}
                </span>
                <button
                  class="col-span-7 grid grid-cols-7 text-center text-xs rounded-md border border-default bg-default transition-colors py-1.5"
                  :class="{
                    'ring-2 ring-primary bg-primary/10 font-semibold border-primary': isWeekSelected(weekRow.weekYear, weekRow.weekNum) && !weekRow.days.every(day => day.isFuture),
                    'ring-2 ring-gray-500 bg-gray-100 text-gray-800 font-semibold border-gray-300 dark:ring-gray-400 dark:bg-gray-900/70 dark:text-gray-100 dark:border-gray-700': isWeekSelected(weekRow.weekYear, weekRow.weekNum) && weekRow.days.every(day => day.isFuture),
                    'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800': !isViewingMember && weekRow.hasReport && !isWeekSelected(weekRow.weekYear, weekRow.weekNum),
                    'hover:bg-gray-100 dark:hover:bg-gray-800': !isWeekSelected(weekRow.weekYear, weekRow.weekNum)
                  }"
                  @click="selectWeek(weekRow.weekYear, weekRow.weekNum)"
                >
                  <span
                    v-for="day in weekRow.days"
                    :key="day.date"
                    class="flex items-center justify-center"
                    :class="{
                      'text-muted': !day.isCurrentMonth || (day.isCurrentMonth && day.isFuture && !day.isToday),
                      'text-default': day.isCurrentMonth && !day.isFuture && !day.isToday,
                      'bg-primary/10 text-primary rounded-full w-5 h-5 mx-auto font-semibold': day.isToday
                    }"
                  >
                    {{ day.day }}
                  </span>
                </button>
              </div>
            </div>

            <!-- 图例（仅部门周报模式） -->
            <div v-if="!isViewingMember" class="mt-4 pt-3 border-t border-default flex items-center justify-center gap-4 text-xs text-muted">
              <span class="flex items-center gap-1">
                <span class="w-2.5 h-2.5 rounded-sm bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700" />
                已发布
              </span>
              <span class="flex items-center gap-1">
                <span class="w-2.5 h-2.5 rounded-full bg-primary" />
                今天
              </span>
            </div>
            <div v-if="!isViewingMember" class="mt-2 text-xs text-muted text-center">
              已创建 {{ reportWeeks.size }} 份周报
            </div>
          </div>

          <!-- 工作报告列表（日历下方） -->
          <div v-if="selectedWeek !== null && memberWorkReports.length > 0" class="mt-4 pt-3 border-t border-default">
            <h4 class="text-xs font-semibold text-muted mb-2">
              {{ selectedMemberName }} 的工作报告
            </h4>
            <div class="space-y-1">
              <button
                v-for="item in memberWorkReports"
                :key="item.uuid"
                class="w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5"
                :class="selectedReport?.uuid === item.uuid
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-default hover:bg-gray-100 dark:hover:bg-gray-800'"
                @click="selectWorkReport(item)"
              >
                <UIcon
                  :name="item.type === 'dept-weekly' ? 'i-lucide-building' : item.type === 'weekly' ? 'i-lucide-file-bar-chart' : 'i-lucide-file-text'"
                  class="w-3.5 h-3.5 shrink-0"
                  :class="item.type === 'worklog' ? 'text-gray-400' : 'text-primary'"
                />
                <span class="truncate">
                  {{ item.title }}
                </span>
              </button>
            </div>
          </div>
          <div v-else-if="selectedWeek !== null && memberReportsLoading" class="mt-4 pt-3 border-t border-default text-center">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin text-muted" />
          </div>
        </template>

        <!-- ===== 工作日志模式 ===== -->
        <template v-if="activeTab === 'worklogs'">
          <!-- 成员选择 -->
          <div v-if="deptMembers.length > 0" class="mb-3 pb-3 border-b border-default">
            <div v-if="deptManagerId" class="mb-2">
              <span class="text-xs text-muted">部门经理：</span>
              <button
                class="text-xs font-medium px-1.5 py-0.5 rounded transition-colors"
                :class="logSelectedMemberUid === deptManagerId
                  ? 'bg-primary text-white'
                  : 'text-primary hover:bg-primary/10'"
                @click="selectLogMember(deptManagerId!)"
              >
                {{ deptManagerName || deptManagerId }}
              </button>
            </div>
            <div v-if="otherMembers.length > 0">
              <span class="text-xs text-muted">部门成员：</span>
              <div class="flex flex-wrap gap-1 mt-1">
                <button
                  v-for="member in otherMembers"
                  :key="member.uid"
                  class="text-xs px-1.5 py-0.5 rounded transition-colors"
                  :class="logSelectedMemberUid === member.uid
                    ? 'bg-primary text-white'
                    : 'text-default hover:bg-gray-100 dark:hover:bg-gray-800'"
                  @click="selectLogMember(member.uid)"
                >
                  {{ member.realName }}
                </button>
              </div>
            </div>
          </div>

          <!-- 日期日历 -->
          <div class="rounded-lg border border-default bg-elevated p-3">
            <div class="flex items-center justify-between mb-3">
              <UButton
                icon="i-lucide-chevron-left"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="logPrevMonth"
              />
              <span class="text-sm font-semibold">{{ logMonthLabel }}</span>
              <UButton
                icon="i-lucide-chevron-right"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="logNextMonth"
              />
            </div>
            <div class="flex justify-center mb-3">
              <UButton
                variant="soft"
                color="primary"
                size="xs"
                @click="logGoToday"
              >
                今天
              </UButton>
            </div>
            <div class="grid grid-cols-8 text-center text-xs text-muted mb-1">
              <span class="font-medium">W</span>
              <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span>
            </div>
            <div class="space-y-1">
              <div
                v-for="weekRow in logCalendarWeeks"
                :key="`${weekRow.weekYear}-${weekRow.weekNum}`"
                class="grid grid-cols-8 items-center gap-0.5"
              >
                <span
                  class="flex items-center justify-center text-[10px] font-semibold"
                  :class="weekRow.isCurrent ? 'text-primary' : 'text-muted'"
                >
                  {{ weekRow.weekNum }}
                </span>
                <button
                  v-for="day in weekRow.days"
                  :key="day.date"
                  class="flex items-center justify-center text-xs rounded-md py-1.5 transition-colors"
                  :class="{
                    'ring-2 ring-primary bg-primary/10 font-semibold': logSelectedDate === day.date && !day.isFuture,
                    'ring-2 ring-gray-400 bg-gray-100 dark:bg-gray-800': logSelectedDate === day.date && day.isFuture,
                    'text-muted': !day.isCurrentMonth || (day.isCurrentMonth && day.isFuture && !day.isToday),
                    'text-default': day.isCurrentMonth && !day.isFuture && !day.isToday && logSelectedDate !== day.date,
                    'bg-primary/10 text-primary font-semibold': day.isToday && logSelectedDate !== day.date,
                    'hover:bg-gray-100 dark:hover:bg-gray-800': logSelectedDate !== day.date
                  }"
                  @click="selectLogDay(day.date)"
                >
                  <span class="relative">
                    {{ day.day }}
                    <span
                      v-if="day.hasLog"
                      class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-500"
                    />
                  </span>
                </button>
              </div>
            </div>

            <!-- 图例 -->
            <div class="mt-4 pt-3 border-t border-default flex items-center justify-center gap-4 text-xs text-muted">
              <span class="flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500" />
                有日志
              </span>
              <span class="flex items-center gap-1">
                <span class="w-2.5 h-2.5 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-semibold">T</span>
                今天
              </span>
            </div>
            <div v-if="logMonthLoading" class="mt-2 text-center">
              <UIcon name="i-lucide-loader-2" class="w-3.5 h-3.5 animate-spin text-muted" />
            </div>
          </div>

          <!-- 当月日志列表 -->
          <div v-if="logMonthItems.length > 0" class="mt-4 pt-3 border-t border-default">
            <h4 class="text-xs font-semibold text-muted mb-2">
              {{ logSelectedMemberName }} 的当月日志（{{ logMonthItems.length }}）
            </h4>
            <div class="space-y-1">
              <button
                v-for="item in logMonthItems"
                :key="item.uuid"
                class="w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5"
                :class="logSelectedDoc?.uuid === item.uuid
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-default hover:bg-gray-100 dark:hover:bg-gray-800'"
                @click="selectLogDay(item.date || '')"
              >
                <UIcon name="i-lucide-file-text" class="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span class="truncate">{{ item.title }}</span>
              </button>
            </div>
          </div>
        </template>
      </aside>
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- 右侧 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div class="md:hidden flex items-center justify-between px-4 py-2 border-b border-default bg-default">
          <UButton
            icon="i-lucide-chevron-left"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="activeTab === 'worklogs' ? logPrevMonth() : prevMonth()"
          />
          <span class="text-sm font-semibold">{{ activeTab === 'worklogs' ? logMonthLabel : monthLabel }}</span>
          <UButton
            icon="i-lucide-chevron-right"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="activeTab === 'worklogs' ? logNextMonth() : nextMonth()"
          />
        </div>
        <div v-if="hasMultipleDepts" class="md:hidden px-4 py-2 border-b border-default bg-default">
          <USelectMenu
            v-model="selectedDept"
            :items="flatDepartments"
            label-key="name"
            placeholder="请选择部门"
            size="sm"
            class="w-full"
            :search-input="false"
          />
        </div>

        <div class="flex-1 overflow-auto p-4">
          <!-- ==================== 工作日志模式右侧 ==================== -->
          <template v-if="activeTab === 'worklogs'">
            <!-- 未选成员 -->
            <div v-if="!logSelectedMemberUid" class="h-full flex items-center justify-center">
              <div class="text-center text-muted">
                <UIcon name="i-lucide-users" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>请在左侧选择一位成员</p>
              </div>
            </div>

            <!-- 加载中 -->
            <div v-else-if="logPreviewLoading" class="h-full flex items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>

            <!-- 有日志文档 -->
            <div v-else-if="logSelectedDoc" class="max-w-4xl mx-auto">
              <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <div class="min-w-0">
                  <h2 class="text-lg font-semibold text-default truncate">
                    {{ logSelectedDoc.title }}
                  </h2>
                  <p class="text-xs text-muted mt-0.5">
                    {{ logSelectedMemberName }} · {{ logSelectedDateLabel }}
                  </p>
                </div>
                <UButton
                  icon="i-lucide-eye"
                  size="sm"
                  color="neutral"
                  variant="outline"
                  @click="viewLogDocument"
                >
                  查看
                </UButton>
              </div>
              <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-75 p-0">
                <EditorDocLazyPreview v-if="logPreviewContent" :content="logPreviewContent" />
              </div>
            </div>

            <!-- 无日志 -->
            <div v-else class="h-full flex items-center justify-center">
              <div class="text-center">
                <UIcon name="i-lucide-file-text" class="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <h3 class="text-lg font-semibold text-default mb-2">
                  {{ logSelectedDateLabel }}
                </h3>
                <p class="text-sm text-muted">
                  {{ logSelectedMemberName }} 当日未填写工作日志
                </p>
              </div>
            </div>
          </template>

          <!-- ==================== 工作周报模式右侧 ==================== -->
          <template v-else>
            <!-- 未选周 -->
            <div v-if="selectedWeek === null" class="h-full flex items-center justify-center">
              <div class="text-center text-muted">
                <UIcon name="i-lucide-calendar-range" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>请在左侧日历中选择一周</p>
              </div>
            </div>

            <!-- 加载中 -->
            <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>

            <!-- ===== 查看成员：周报未上报 ===== -->
            <div v-else-if="isViewingMember && memberWeeklyMissing && !selectedReport" class="max-w-4xl mx-auto">
              <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 class="text-lg font-semibold text-default truncate">
                  {{ selectedMemberName }} · {{ selectedWeekLabel }}
                </h2>
              </div>
              <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg p-8 text-center">
                <UIcon name="i-lucide-file-x" class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p class="text-muted">
                  {{ selectedMemberName }} 当周工作周报未上报
                </p>
                <p v-if="memberWorkReports.length > 0" class="text-xs text-muted mt-2">
                  可在左侧查看其工作日志
                </p>
                <UButton
                  v-if="canRemindPersonal"
                  icon="i-lucide-bell-ring"
                  size="sm"
                  color="warning"
                  variant="soft"
                  class="mt-4"
                  @click="openRemindConfirm('personal-report', selectedMemberUid!, selectedMemberName)"
                >
                  提醒上报
                </UButton>
              </div>
            </div>

            <!-- ===== 查看成员：有文档预览 ===== -->
            <div v-else-if="isViewingMember && selectedReport" class="max-w-4xl mx-auto">
              <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 class="text-lg font-semibold text-default truncate">
                  {{ selectedReport.title }}
                </h2>
                <UButton
                  icon="i-lucide-eye"
                  size="sm"
                  color="neutral"
                  variant="outline"
                  @click="editReport"
                >
                  查看
                </UButton>
              </div>
              <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-75 p-0">
                <EditorDocLazyPreview v-if="previewContent" :content="previewContent" />
              </div>
            </div>

            <!-- ===== 部门周报：有周报 ===== -->
            <div v-else-if="!isViewingMember && selectedReport" class="max-w-4xl mx-auto">
              <!-- 标题栏 -->
              <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  <h2 class="text-lg font-semibold text-default truncate">
                    {{ selectedWeekLabel }}
                  </h2>
                  <!-- 状态标签 -->
                  <span
                    v-if="isSubmitted && hasRevisions && !isViewingArchive"
                    class="shrink-0 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded"
                  >
                    已修订
                  </span>
                  <span
                    v-else-if="isSubmitted && !isViewingArchive"
                    class="shrink-0 text-xs text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded"
                  >
                    已发布
                  </span>
                  <span
                    v-else-if="isDeptHead && !isSubmitted && !isViewingArchive"
                    class="shrink-0 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded"
                  >
                    {{ isBeingRevised ? '修订中' : '草稿' }}
                  </span>
                  <span
                    v-if="isViewingArchive"
                    class="shrink-0 text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 px-1.5 py-0.5 rounded"
                  >
                    历史存档
                  </span>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <!-- 负责人：历史版本切换 -->
                  <template v-if="isDeptHead && weekVersions.length > 0">
                    <select
                      class="text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary"
                      :value="isViewingArchive ? selectedReport.uuid : '__current__'"
                      @change="(e) => {
                        const val = (e.target as HTMLSelectElement).value
                        if (val === '__current__') switchToCurrent()
                        else switchToVersion(val)
                      }"
                    >
                      <option value="__current__">
                        当前版本{{ currentWeekReport?.readonly_flag ? '' : '（编辑中）' }}
                      </option>
                      <option v-for="v in weekVersions" :key="v.uuid" :value="v.uuid">
                        存档V{{ v.versionNum }}
                      </option>
                    </select>
                  </template>

                  <!-- 负责人操作 -->
                  <template v-if="isDeptHead && !isViewingArchive">
                    <UButton
                      v-if="!isSubmitted"
                      icon="i-lucide-send"
                      size="sm"
                      color="primary"
                      @click="showSubmitConfirm = true"
                    >
                      提交发布
                    </UButton>
                    <UButton
                      v-if="isSubmitted"
                      icon="i-lucide-pen-line"
                      size="sm"
                      color="neutral"
                      variant="outline"
                      @click="showReviseConfirm = true"
                    >
                      修订
                    </UButton>
                    <UButton
                      :icon="isSubmitted ? 'i-lucide-eye' : 'i-lucide-edit'"
                      size="sm"
                      :color="isSubmitted ? 'neutral' : 'primary'"
                      :variant="isSubmitted ? 'outline' : 'solid'"
                      @click="editReport"
                    >
                      {{ isSubmitted ? '查看' : '编辑' }}
                    </UButton>
                  </template>

                  <!-- 负责人查看存档 -->
                  <UButton
                    v-if="isDeptHead && isViewingArchive"
                    icon="i-lucide-eye"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    @click="editReport"
                  >
                    查看
                  </UButton>

                  <!-- 非负责人 -->
                  <UButton
                    v-if="!isDeptHead"
                    icon="i-lucide-eye"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    @click="editReport"
                  >
                    查看
                  </UButton>
                </div>
              </div>

              <!-- 非负责人：正在修订提示 -->
              <div
                v-if="!isDeptHead && isBeingRevised"
                class="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2"
              >
                <UIcon name="i-lucide-info" class="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <p class="text-sm text-amber-700 dark:text-amber-300">
                  本周报正在修订中，当前展示的是修订前的版本，请关注后续发布的修订版。
                </p>
              </div>

              <!-- 预览 -->
              <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-75 p-0">
                <EditorDocLazyPreview v-if="previewContent" :content="previewContent" />
              </div>
            </div>

            <!-- ===== 部门周报：无周报 ===== -->
            <div v-else-if="!isViewingMember" class="h-full flex items-center justify-center">
              <div class="text-center">
                <UIcon name="i-lucide-file-text" class="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <h3 class="text-lg font-semibold text-default mb-2">
                  {{ selectedWeekLabel }}
                </h3>
                <p class="text-sm text-muted mb-6">
                  {{ isDeptHead ? (currentDeptName ? currentDeptName + '尚未创建该周周报' : '尚未创建该周周报') : '该周暂无已发布的周报' }}
                </p>
                <UButton
                  v-if="canCreate"
                  icon="i-lucide-plus"
                  color="primary"
                  :loading="isCreating"
                  @click="createReport"
                >
                  创建周报
                </UButton>
                <p v-else-if="isDeptHead && selectedWeek !== null" class="text-xs text-muted">
                  不能为未来的周创建周报
                </p>
                <UButton
                  v-if="canRemindDept && !isDeptHead"
                  icon="i-lucide-bell-ring"
                  size="sm"
                  color="warning"
                  variant="soft"
                  class="mt-4"
                  @click="openRemindConfirm('dept-report')"
                >
                  提醒填报
                </UButton>
              </div>
            </div>
          </template>
        </div>
      </main>
    </div>

    <!-- 提交确认 -->
    <UModal v-model:open="showSubmitConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-send" class="w-5 h-5 text-primary" />
              <h3 class="text-lg font-semibold">
                确认提交
              </h3>
            </div>
          </template>
          <p class="text-muted">
            确定要提交并发布 <strong class="text-default">"{{ currentWeekReport?.title }}"</strong> 吗？
          </p>
          <p class="text-sm text-amber-600 dark:text-amber-400 mt-2">
            提交后周报将设为只读，并通知部门成员、分管领导及上级部门负责人。
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showSubmitConfirm = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isSubmitting" @click="submitReport">
                确认提交
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- 修订确认 -->
    <UModal v-model:open="showReviseConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-pen-line" class="w-5 h-5 text-primary" />
              <h3 class="text-lg font-semibold">
                确认修订
              </h3>
            </div>
          </template>
          <p class="text-muted">
            当前已发布版本将作为历史存档保留（只读），周报将恢复为可编辑状态。
          </p>
          <p class="text-sm text-muted mt-2">
            修订期间仅您可见，编辑完成后需重新提交发布。
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showReviseConfirm = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isRevising" @click="reviseReport">
                开始修订
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- 提醒确认 -->
    <UModal v-model:open="showRemindConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-bell-ring" class="w-5 h-5 text-warning" />
              <h3 class="text-lg font-semibold">
                确认发送提醒
              </h3>
            </div>
          </template>
          <p v-if="remindType === 'personal-report'" class="text-muted">
            将向 <strong class="text-default">{{ remindTargetName }}</strong> 发送工作周报填报提醒。
          </p>
          <p v-else class="text-muted">
            将向 <strong class="text-default">{{ currentDeptName }}</strong> 部门负责人发送部门周报填报提醒。
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showRemindConfirm = false">
                取消
              </UButton>
              <UButton color="warning" :loading="isReminding" @click="sendRemind">
                发送提醒
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- 同步钉钉确认 -->
    <UModal v-model:open="showSyncConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-refresh-cw" class="w-5 h-5 text-primary" />
              <h3 class="text-lg font-semibold">
                同步钉钉日志周报
              </h3>
            </div>
          </template>
          <p class="text-muted">
            {{ syncConfirmMessage }}
          </p>
          <p class="text-sm text-muted mt-2">
            已存在的文档将自动跳过，不会重复创建。同步的文档将设为只读。
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showSyncConfirm = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isSyncing" @click="syncDingtalkReports">
                开始同步
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
