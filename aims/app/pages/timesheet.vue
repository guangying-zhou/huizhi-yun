<script setup lang="ts">
import type { AimsProject, ProjectRole } from '~/types/aims'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目日历',
  layoutHeaderProjectSwitcher: false
})

type SubmitMode = 'hours' | 'percent'

interface RawTimeEntry {
  id: number
  workItemId?: number | null
  work_item_id?: number | null
  projectId?: number
  project_id?: number
  projectCode?: string
  project_code?: string
  projectName?: string
  project_name?: string
  projectShortName?: string
  project_short_name?: string
  itemKey?: string
  item_key?: string
  itemTitle?: string
  item_title?: string
  title?: string
  uid: string
  entryDate?: string
  entry_date?: string
  hours: number | string
  description?: string | null
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

interface TimeEntry {
  id: number
  workItemId: number | null
  projectId: number
  projectCode: string
  projectName: string
  projectShortName: string
  itemKey: string
  itemTitle: string
  uid: string
  entryDate: string
  hours: number
  description: string | null
  createdAt: string
  updatedAt: string
}

interface ProjectTimeRow {
  projectId: number
  hours: number
  percent: number
  existingHours: number
}

interface TimeEntryEditRow {
  id: number | null
  key: string
  projectId: number
  projectName: string
  projectCode: string
  itemKey: string
  itemTitle: string
  hours: number
  originalHours: number
  description: string
  originalDescription: string
}

interface ListPayload<T> {
  items?: T[]
}

const toast = useToast()
const { user: authUser } = useAuth()
const { users: accountUsers } = useAccountUsers()
const projectStore = useProjectStore()

const currentMonth = ref(startOfMonth(new Date()))
const selectedProjectId = ref<number | 'all'>('all')
const entries = ref<TimeEntry[]>([])
const entriesLoading = ref(false)
const modalOpen = ref(false)
const detailModalOpen = ref(false)
const selectedDate = ref(formatLocalDate(new Date()))
const submitting = ref(false)
const detailSubmitting = ref(false)
const projectsLoading = ref(false)
const projectMemberRoles = ref<Map<number, ProjectRole>>(new Map())
const projectTimeRows = ref<ProjectTimeRow[]>([])
const detailRows = ref<TimeEntryEditRow[]>([])

const form = reactive<{
  mode: SubmitMode
  description: string
}>({
  mode: 'hours',
  description: ''
})

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
const todayKey = computed(() => formatLocalDate(new Date()))
const monthStartKey = computed(() => formatLocalDate(startOfMonth(currentMonth.value)))
const monthEndKey = computed(() => formatLocalDate(endOfMonth(currentMonth.value)))
const monthTitle = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth() + 1
  return `${year}年${month}月`
})

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const item of accountUsers.value) {
    if (item.realName?.trim()) map.set(item.uid, item.realName.trim())
  }
  return map
})

const availableProjects = computed(() => {
  const uid = authUser.value
  return projectStore.projects.filter((project) => {
    if (project.lifecycleStatus === 'archived' || project.canAccess === false) return false
    if (!uid) return false
    if (project.leaderUid === uid) return true
    const role = project.currentUserRole || projectMemberRoles.value.get(project.id)
    if (role === 'manager' || role === 'member') return true
    return false
  })
})

const selectedProject = computed(() => {
  if (selectedProjectId.value === 'all') return null
  return availableProjects.value.find(project => project.id === selectedProjectId.value) || null
})

const filteredEntries = computed(() => {
  if (selectedProjectId.value === 'all') return entries.value
  return entries.value.filter(entry => entry.projectId === selectedProjectId.value)
})

const entriesByDate = computed(() => {
  const map = new Map<string, TimeEntry[]>()
  for (const entry of filteredEntries.value) {
    const key = normalizeDateOnly(entry.entryDate)
    if (!key) continue
    const list = map.get(key) || []
    list.push(entry)
    map.set(key, list)
  }
  return map
})

const projectHours = computed(() => {
  const map = new Map<number, { hours: number, days: Set<string> }>()
  for (const entry of entries.value) {
    const bucket = map.get(entry.projectId) || { hours: 0, days: new Set<string>() }
    bucket.hours += entry.hours
    bucket.days.add(entry.entryDate)
    map.set(entry.projectId, bucket)
  }
  return map
})

const totalMonthHours = computed(() => {
  return filteredEntries.value.reduce((sum, entry) => sum + entry.hours, 0)
})

const submittedDays = computed(() => {
  return Array.from(entriesByDate.value.values()).filter(list => sumHours(list) > 0).length
})

const missingDays = computed(() => {
  return calendarDays.value.filter(day => day.inMonth && day.isPastOrToday && day.totalHours <= 0).length
})

const reportableRows = computed(() => {
  return projectTimeRows.value
    .map(row => ({ ...row, submitHours: rowSubmitHours(row) }))
    .filter(row => row.submitHours > 0)
})

const reportTotalHours = computed(() => {
  return roundHours(reportableRows.value.reduce((sum, row) => sum + row.submitHours, 0))
})

const reportTotalPercent = computed(() => {
  return roundHours(projectTimeRows.value.reduce((sum, row) => sum + Math.max(0, Number(row.percent || 0)), 0))
})

const reportSubmitDisabled = computed(() => {
  if (submitting.value || reportableRows.value.length === 0) return true
  if (reportTotalHours.value > 24) return true
  if (form.mode === 'percent' && reportTotalPercent.value > 100) return true
  return false
})

const detailTotalHours = computed(() => {
  return roundHours(detailRows.value.reduce((sum, row) => sum + Math.max(0, Number(row.hours || 0)), 0))
})

const changedDetailRows = computed(() => {
  return detailRows.value.filter(row => rowChanged(row))
})

const detailSubmitDisabled = computed(() => {
  if (detailSubmitting.value || changedDetailRows.value.length === 0) return true
  if (changedDetailRows.value.some(row => !validDetailRowHours(row))) return true
  if (detailTotalHours.value > 24) return true
  return false
})

const calendarDays = computed(() => {
  const first = startOfMonth(currentMonth.value)
  const firstWeekday = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -firstWeekday)
  const month = first.getMonth()

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    const dateKey = formatLocalDate(date)
    const dayEntries = entriesByDate.value.get(dateKey) || []
    const totalHours = sumHours(dayEntries)
    return {
      date,
      dateKey,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: dateKey === todayKey.value,
      isPastOrToday: dateKey <= todayKey.value,
      entries: dayEntries,
      totalHours,
      projectGroups: groupEntriesByProject(dayEntries)
    }
  })
})

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function normalizeDateOnly(value: string | null | undefined) {
  return String(value || '').slice(0, 10)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function roundHours(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function sumHours(list: TimeEntry[]) {
  return roundHours(list.reduce((sum, entry) => sum + entry.hours, 0))
}

function listPayload<T>(data: T[] | ListPayload<T> | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function normalizeEntry(raw: RawTimeEntry): TimeEntry {
  return {
    id: Number(raw.id),
    workItemId: raw.workItemId ?? raw.work_item_id ?? null,
    projectId: Number(raw.projectId ?? raw.project_id ?? 0),
    projectCode: raw.projectCode || raw.project_code || '',
    projectName: raw.projectName || raw.project_name || '',
    projectShortName: raw.projectShortName || raw.project_short_name || '',
    itemKey: raw.itemKey || raw.item_key || '',
    itemTitle: raw.itemTitle || raw.item_title || raw.title || '',
    uid: raw.uid,
    entryDate: normalizeDateOnly(raw.entryDate || raw.entry_date),
    hours: Number(raw.hours || 0),
    description: raw.description || null,
    createdAt: raw.createdAt || raw.created_at || '',
    updatedAt: raw.updatedAt || raw.updated_at || ''
  }
}

function groupEntriesByProject(dayEntries: TimeEntry[]) {
  const map = new Map<number, {
    projectId: number
    projectCode: string
    projectName: string
    hours: number
    entries: TimeEntry[]
  }>()

  for (const entry of dayEntries) {
    const bucket = map.get(entry.projectId) || {
      projectId: entry.projectId,
      projectCode: entry.projectCode,
      projectName: entry.projectShortName || entry.projectName || `项目 ${entry.projectId}`,
      hours: 0,
      entries: []
    }
    bucket.hours += entry.hours
    bucket.entries.push(entry)
    map.set(entry.projectId, bucket)
  }

  return Array.from(map.values())
    .map(item => ({ ...item, hours: roundHours(item.hours) }))
    .sort((a, b) => b.hours - a.hours)
}

function projectDisplayName(project: AimsProject) {
  return project.shortName || project.name
}

function projectRoleLabel(project: AimsProject) {
  if (project.leaderUid === authUser.value) return '管理'
  const role = project.currentUserRole || projectMemberRoles.value.get(project.id)
  if (role === 'manager' || role === 'member') return '参与'
  return '可访问'
}

function getLeaderName(project: AimsProject) {
  if (!project.leaderUid) return '未设置'
  return userNameMap.value.get(project.leaderUid) || project.leaderUid
}

function selectProject(projectId: number | 'all') {
  selectedProjectId.value = projectId
}

function dayClass(day: { inMonth: boolean, isToday: boolean, isPastOrToday: boolean, totalHours: number }) {
  const classes = ['border-default']
  if (!day.inMonth) {
    classes.push('bg-elevated/30 opacity-60')
  } else if (day.totalHours >= 8) {
    classes.push('border-success/30 bg-success/10')
  } else if (day.totalHours > 0) {
    classes.push('border-warning/30 bg-warning/10')
  } else if (day.isPastOrToday) {
    classes.push('border-error/25 bg-error/5')
  } else {
    classes.push('bg-default')
  }
  if (day.isToday) {
    classes.push('ring-2 ring-primary/40')
  }
  return classes.join(' ')
}

function goPreviousMonth() {
  currentMonth.value = addMonths(currentMonth.value, -1)
}

function goNextMonth() {
  currentMonth.value = addMonths(currentMonth.value, 1)
}

function goCurrentMonth() {
  currentMonth.value = startOfMonth(new Date())
}

async function loadProjects() {
  if (!authUser.value) return
  projectsLoading.value = true
  try {
    if (projectStore.projects.length === 0) {
      await projectStore.fetchProjects({ pageSize: 500 })
    }
    await loadProjectMemberRoles()
  } finally {
    projectsLoading.value = false
  }
}

async function loadProjectMemberRoles() {
  const uid = authUser.value
  if (!uid) return

  const roles = new Map<number, ProjectRole>()
  const targets = projectStore.projects.filter(project => project.leaderUid !== uid)
  const batchSize = 8

  for (let index = 0; index < targets.length; index += batchSize) {
    const batch = targets.slice(index, index + batchSize)
    await Promise.all(batch.map(async (project) => {
      try {
        const members = await projectStore.fetchMembers(project.id)
        const currentMember = members.find(member => member.uid === uid && member.status === 'active')
        if (currentMember?.role) {
          roles.set(project.id, currentMember.role)
        }
      } catch {
        // 成员读取失败时只影响该项目是否进入个人日历，不阻塞页面。
      }
    }))
  }

  projectMemberRoles.value = roles
}

async function loadEntries() {
  if (!authUser.value) return
  entriesLoading.value = true
  try {
    const params = new URLSearchParams()
    params.set('startDate', monthStartKey.value)
    params.set('endDate', monthEndKey.value)
    params.set('pageSize', '500')
    const res = await $fetch<{ code: number, data: RawTimeEntry[] | ListPayload<RawTimeEntry> }>(
      `/api/v1/users/${encodeURIComponent(authUser.value)}/time-entries?${params.toString()}`
    )
    entries.value = res.code === 0
      ? listPayload(res.data).map(normalizeEntry).filter(entry => entry.projectId > 0)
      : []
  } catch (err: unknown) {
    console.error('[ProjectCalendar] load entries failed:', err)
    entries.value = []
    toast.add({ title: '工时数据加载失败', color: 'error' })
  } finally {
    entriesLoading.value = false
  }
}

function projectRowsForDate(dateKey: string) {
  const dateEntries = entries.value.filter(entry => entry.entryDate === dateKey)
  const projects = [...availableProjects.value]
  if (selectedProjectId.value !== 'all') {
    const selectedIndex = projects.findIndex(project => project.id === selectedProjectId.value)
    if (selectedIndex > 0) {
      const [selected] = projects.splice(selectedIndex, 1)
      if (selected) projects.unshift(selected)
    }
  }

  return projects.map(project => ({
    projectId: project.id,
    hours: 0,
    percent: 0,
    existingHours: sumHours(dateEntries.filter(entry => entry.projectId === project.id))
  }))
}

function rowProject(projectId: number) {
  return availableProjects.value.find(project => project.id === projectId) || null
}

function rowProjectName(projectId: number) {
  const project = rowProject(projectId)
  return project ? projectDisplayName(project) : `项目 ${projectId}`
}

function rowProjectCode(projectId: number) {
  return rowProject(projectId)?.projectCode || `#${projectId}`
}

function rowProjectRoleLabel(projectId: number) {
  const project = rowProject(projectId)
  return project ? projectRoleLabel(project) : ''
}

function rowProjectRoleColor(projectId: number): 'primary' | 'neutral' {
  return rowProjectRoleLabel(projectId) === '管理' ? 'primary' : 'neutral'
}

function rowSubmitHours(row: ProjectTimeRow) {
  const value = form.mode === 'percent'
    ? Number(row.percent || 0) * 8 / 100
    : Number(row.hours || 0)
  if (value <= 0) return 0
  return roundHours(value)
}

function resetReportRows(dateKey: string) {
  projectTimeRows.value = projectRowsForDate(dateKey)
}

function entryProjectName(entry: TimeEntry) {
  return entry.projectShortName || entry.projectName || `项目 ${entry.projectId}`
}

function entryProjectCode(entry: TimeEntry) {
  return entry.projectCode || `#${entry.projectId}`
}

function detailRowFromEntry(entry: TimeEntry): TimeEntryEditRow {
  return {
    id: entry.id,
    key: `entry-${entry.id}`,
    projectId: entry.projectId,
    projectName: entryProjectName(entry),
    projectCode: entryProjectCode(entry),
    itemKey: entry.itemKey,
    itemTitle: entry.itemTitle,
    hours: entry.hours,
    originalHours: entry.hours,
    description: entry.description || '',
    originalDescription: entry.description || ''
  }
}

function blankDetailRow(project: AimsProject): TimeEntryEditRow {
  return {
    id: null,
    key: `project-${project.id}`,
    projectId: project.id,
    projectName: projectDisplayName(project),
    projectCode: project.projectCode || `#${project.id}`,
    itemKey: '',
    itemTitle: '',
    hours: 0,
    originalHours: 0,
    description: '',
    originalDescription: ''
  }
}

function detailRowsForDate(dateKey: string) {
  const dateEntries = entries.value.filter(entry => entry.entryDate === dateKey)
  const rows: TimeEntryEditRow[] = []
  const consumedEntryIds = new Set<number>()

  for (const project of availableProjects.value) {
    const projectEntries = dateEntries.filter(entry => entry.projectId === project.id)
    if (projectEntries.length === 0) {
      rows.push(blankDetailRow(project))
      continue
    }
    for (const entry of projectEntries) {
      rows.push(detailRowFromEntry(entry))
      consumedEntryIds.add(entry.id)
    }
  }

  for (const entry of dateEntries) {
    if (!consumedEntryIds.has(entry.id)) {
      rows.push(detailRowFromEntry(entry))
    }
  }

  return rows
}

function openDayDetailModal(day: { inMonth: boolean, dateKey: string, totalHours: number }) {
  if (!day.inMonth || day.totalHours <= 0) return
  selectedDate.value = day.dateKey
  detailRows.value = detailRowsForDate(day.dateKey)
  detailModalOpen.value = true
}

function openReportModal(dateKey: string) {
  selectedDate.value = dateKey
  form.mode = 'hours'
  form.description = ''
  resetReportRows(dateKey)
  modalOpen.value = true
}

async function submitTimeEntry() {
  const rows = reportableRows.value
  if (rows.length === 0) {
    toast.add({ title: '请至少为一个项目填写有效工时', color: 'warning' })
    return
  }
  if (reportTotalHours.value > 24) {
    toast.add({ title: '单日工时不能超过 24 小时', color: 'warning' })
    return
  }
  if (form.mode === 'percent' && reportTotalPercent.value > 100) {
    toast.add({ title: '投入比例合计不能超过 100%', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    await Promise.all(rows.map(row => postProjectTimeEntry(row)))
    toast.add({ title: `已填报 ${rows.length} 个项目，共 ${reportTotalHours.value.toFixed(1)}h`, color: 'success' })
    modalOpen.value = false
    await loadEntries()
  } catch (err: unknown) {
    console.error('[ProjectCalendar] submit time entry failed:', err)
    const message = (err as { data?: { message?: string } })?.data?.message || '填报失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    submitting.value = false
  }
}

function postProjectTimeEntry(row: ProjectTimeRow & { submitHours: number }) {
  return createProjectTimeEntry(row.projectId, row.submitHours, form.description || null)
}

function createProjectTimeEntry(projectId: number, hours: number, description: string | null) {
  const url = `/api/v1/projects/${projectId}/time-entries` as string
  return $fetch(url, {
    method: 'POST',
    body: {
      entryDate: selectedDate.value,
      hours,
      description
    }
  })
}

function postDetailTimeEntry(row: TimeEntryEditRow) {
  return createProjectTimeEntry(row.projectId, roundHours(Number(row.hours || 0)), row.description.trim() || null)
}

function rowChanged(row: TimeEntryEditRow) {
  if (row.id === null) {
    return roundHours(Number(row.hours || 0)) !== 0
  }
  return roundHours(Number(row.hours || 0)) !== row.originalHours
    || row.description.trim() !== row.originalDescription.trim()
}

function validDetailRowHours(row: TimeEntryEditRow) {
  const hours = roundHours(Number(row.hours || 0))
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return false
  if (row.id === null) return hours > 0
  return true
}

async function submitDetailChanges() {
  const rows = changedDetailRows.value
  if (rows.length === 0) return
  if (detailTotalHours.value > 24) {
    toast.add({ title: '单日工时不能超过 24 小时', color: 'warning' })
    return
  }
  const invalid = rows.some(row => !validDetailRowHours(row))
  if (invalid) {
    toast.add({ title: '新增工时必须大于 0；已有工时可清零删除，且单条不超过 24 小时', color: 'warning' })
    return
  }

  detailSubmitting.value = true
  try {
    await Promise.all(rows.map(saveDetailTimeEntry))
    toast.add({ title: `已保存 ${rows.length} 条工时记录`, color: 'success' })
    detailModalOpen.value = false
    await loadEntries()
  } catch (err: unknown) {
    console.error('[ProjectCalendar] update time entry failed:', err)
    const message = (err as { data?: { message?: string } })?.data?.message || '更新失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    detailSubmitting.value = false
  }
}

function saveDetailTimeEntry(row: TimeEntryEditRow) {
  if (row.id === null) return postDetailTimeEntry(row)
  if (roundHours(Number(row.hours || 0)) <= 0) return deleteProjectTimeEntry(row)
  return patchProjectTimeEntry(row)
}

function patchProjectTimeEntry(row: TimeEntryEditRow) {
  if (row.id === null) return postDetailTimeEntry(row)
  const url = `/api/v1/projects/${row.projectId}/time-entries/${row.id}` as string
  return $fetch(url, {
    method: 'PATCH',
    body: {
      hours: roundHours(Number(row.hours || 0)),
      description: row.description.trim() || null
    }
  })
}

function deleteProjectTimeEntry(row: TimeEntryEditRow) {
  if (row.id === null) return Promise.resolve()
  const url = `/api/v1/projects/${row.projectId}/time-entries/${row.id}` as string
  return $fetch(url, { method: 'DELETE' })
}

watch(currentMonth, () => {
  loadEntries()
})

onMounted(async () => {
  await loadProjects()
  await loadEntries()
})
</script>

<template>
  <UDashboardPanel id="project-calendar" :ui="{ root: 'relative flex min-w-0 shrink-0 flex-col h-full', body: 'flex min-h-0 flex-1 flex-col p-0 overflow-hidden' }">
    <template #body>
      <div class="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(15rem,20%)_minmax(0,1fr)]">
        <aside class="flex min-h-0 flex-col border-b border-default bg-default/80 xl:border-r xl:border-b-0">
          <div class="flex items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                我的项目
              </p>
              <p class="text-xs text-muted">
                {{ availableProjects.length }} 个管理或参与项目
              </p>
            </div>
            <UButton
              label="全部"
              size="xs"
              :color="selectedProjectId === 'all' ? 'primary' : 'neutral'"
              :variant="selectedProjectId === 'all' ? 'soft' : 'ghost'"
              @click="selectProject('all')"
            />
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <div v-if="projectsLoading || projectStore.loading" class="space-y-2">
              <USkeleton v-for="index in 4" :key="index" class="h-24 rounded-lg" />
            </div>

            <div v-else-if="availableProjects.length === 0" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
              <UIcon name="i-lucide-folder-open" class="mx-auto mb-2 size-8" />
              暂无可填报项目
            </div>

            <div v-else class="space-y-2">
              <button
                v-for="project in availableProjects"
                :key="project.id"
                type="button"
                class="w-full rounded-lg border p-3 text-left transition hover:bg-elevated"
                :class="selectedProjectId === project.id ? 'border-primary bg-primary/10' : 'border-default bg-default'"
                @click="selectProject(project.id)"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-highlighted">
                      {{ projectDisplayName(project) }}
                    </div>
                    <div class="mt-0.5 font-mono text-xs text-muted">
                      {{ project.projectCode }} {{ getLeaderName(project) }}
                    </div>
                  </div>
                  <UBadge
                    :color="projectRoleLabel(project) === '管理' ? 'primary' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ projectRoleLabel(project) }}
                  </UBadge>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div class="text-muted">
                    填报天数： {{ projectHours.get(project.id)?.days.size || 0 }}
                  </div>
                  <div>
                    <div class="text-muted">
                      工时：{{ (projectHours.get(project.id)?.hours || 0).toFixed(1) }}h
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </aside>

        <main class="flex min-h-0 min-w-0 flex-col bg-elevated/20">
          <div class="flex flex-col gap-3 border-b border-default bg-default px-4 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                square
                @click="goPreviousMonth"
              />
              <div class="min-w-36 text-center text-base font-semibold text-highlighted">
                {{ monthTitle }}
              </div>
              <UButton
                icon="i-lucide-chevron-right"
                color="neutral"
                variant="ghost"
                square
                @click="goNextMonth"
              />
              <UButton
                label="本月"
                icon="i-lucide-calendar-days"
                color="neutral"
                variant="soft"
                size="sm"
                @click="goCurrentMonth"
              />
            </div>

            <div class="flex flex-wrap items-center gap-2 text-sm">
              <UBadge color="neutral" variant="subtle">
                {{ selectedProject ? projectDisplayName(selectedProject) : '全部项目' }}
              </UBadge>
              <UBadge color="primary" variant="subtle">
                {{ totalMonthHours.toFixed(1) }}h
              </UBadge>
              <UBadge color="success" variant="subtle">
                已填 {{ submittedDays }} 天
              </UBadge>
              <UBadge color="warning" variant="subtle">
                待填 {{ missingDays }} 天
              </UBadge>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-4">
            <div class="min-w-[72rem] space-y-2">
              <div class="grid grid-cols-7 gap-2">
                <div
                  v-for="label in weekdayLabels"
                  :key="label"
                  class="rounded-md border border-default bg-default px-3 py-2 text-center text-xs font-medium text-muted"
                >
                  周{{ label }}
                </div>
              </div>

              <div v-if="entriesLoading" class="grid grid-cols-7 gap-2">
                <USkeleton v-for="index in 42" :key="index" class="h-36 rounded-lg" />
              </div>

              <div v-else class="grid grid-cols-7 gap-2">
                <div
                  v-for="day in calendarDays"
                  :key="day.dateKey"
                  class="flex min-h-36 flex-col rounded-lg border p-2"
                  :class="[dayClass(day), day.totalHours > 0 ? 'cursor-pointer transition hover:bg-elevated' : '']"
                  @click="openDayDetailModal(day)"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-1">
                      <span class="text-sm font-semibold" :class="day.inMonth ? 'text-highlighted' : 'text-muted'">
                        {{ day.dayNumber }}
                      </span>
                      <UBadge
                        v-if="day.isToday"
                        color="primary"
                        variant="subtle"
                        size="xs"
                      >
                        今天
                      </UBadge>
                    </div>
                    <span v-if="day.totalHours > 0" class="text-xs font-semibold text-highlighted">
                      {{ day.totalHours.toFixed(1) }}h
                    </span>
                  </div>

                  <div class="mt-2 min-h-0 flex-1 space-y-1 overflow-hidden">
                    <div
                      v-for="group in day.projectGroups.slice(0, 3)"
                      :key="group.projectId"
                      class="rounded-md border border-default bg-default/80 px-2 py-1"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate text-xs font-medium text-highlighted">
                          {{ group.projectName }}
                        </span>
                        <span class="shrink-0 text-xs font-semibold text-primary">
                          {{ group.hours.toFixed(1) }}h
                        </span>
                      </div>
                      <div v-if="group.entries.some(entry => entry.itemKey)" class="mt-0.5 truncate font-mono text-[11px] text-muted">
                        {{ group.entries.map(entry => entry.itemKey).filter(Boolean).slice(0, 2).join(' / ') }}
                      </div>
                    </div>

                    <div v-if="day.projectGroups.length > 3" class="px-1 text-[11px] text-muted">
                      另有 {{ day.projectGroups.length - 3 }} 个项目
                    </div>
                  </div>

                  <UButton
                    v-if="day.inMonth && day.isPastOrToday && day.totalHours <= 0"
                    label="填报"
                    icon="i-lucide-plus"
                    color="primary"
                    variant="soft"
                    size="xs"
                    class="mt-2 justify-center"
                    @click.stop="openReportModal(day.dateKey)"
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <UModal v-model:open="modalOpen" :title="`填报工时 · ${selectedDate}`" :ui="{ content: 'sm:max-w-3xl', body: 'p-0' }">
        <template #body>
          <div class="space-y-4 p-4">
            <UFormField label="填报方式">
              <div class="flex rounded-lg border border-default p-1">
                <UButton
                  class="flex-1 justify-center"
                  label="直接填工时"
                  icon="i-lucide-clock"
                  size="sm"
                  :color="form.mode === 'hours' ? 'primary' : 'neutral'"
                  :variant="form.mode === 'hours' ? 'soft' : 'ghost'"
                  @click="form.mode = 'hours'"
                />
                <UButton
                  class="flex-1 justify-center"
                  label="按百分比"
                  icon="i-lucide-percent"
                  size="sm"
                  :color="form.mode === 'percent' ? 'primary' : 'neutral'"
                  :variant="form.mode === 'percent' ? 'soft' : 'ghost'"
                  @click="form.mode = 'percent'"
                />
              </div>
            </UFormField>

            <UFormField label="项目工时" required>
              <template #hint>
                <span>{{ reportTotalHours.toFixed(1) }}h</span>
              </template>

              <div v-if="projectTimeRows.length === 0" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
                暂无可填报项目
              </div>

              <div v-else class="max-h-[52vh] overflow-y-auto rounded-lg border border-default">
                <div
                  v-for="row in projectTimeRows"
                  :key="row.projectId"
                  class="grid gap-3 border-b border-default px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_13rem] md:items-center"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="truncate text-sm font-medium text-highlighted">
                        {{ rowProjectName(row.projectId) }}
                      </span>
                      <UBadge
                        v-if="rowProjectRoleLabel(row.projectId)"
                        :color="rowProjectRoleColor(row.projectId)"
                        variant="subtle"
                        size="xs"
                      >
                        {{ rowProjectRoleLabel(row.projectId) }}
                      </UBadge>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span class="font-mono">{{ rowProjectCode(row.projectId) }}</span>
                      <span v-if="row.existingHours > 0">已填 {{ row.existingHours.toFixed(1) }}h</span>
                    </div>
                  </div>

                  <div v-if="form.mode === 'hours'" class="flex items-center gap-2">
                    <UInput
                      v-model.number="row.hours"
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      class="min-w-0 flex-1"
                      placeholder="0"
                    />
                    <span class="w-8 shrink-0 text-sm text-muted">小时</span>
                  </div>

                  <div v-else class="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-2">
                    <UInput
                      v-model.number="row.percent"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      class="min-w-0"
                      placeholder="0"
                    />
                    <span class="text-sm text-muted">%</span>
                    <span class="text-right text-sm font-medium text-highlighted">{{ rowSubmitHours(row).toFixed(1) }}h</span>
                  </div>
                </div>
              </div>

              <p class="mt-2 text-xs text-muted">
                百分比模式按每天 8 小时折算。合计：{{ reportTotalHours.toFixed(1) }}h<span v-if="form.mode === 'percent'"> / {{ reportTotalPercent.toFixed(0) }}%</span>。
              </p>
              <p v-if="reportTotalHours > 24" class="mt-1 text-xs text-warning">
                单日工时合计不能超过 24 小时。
              </p>
              <p v-if="form.mode === 'percent' && reportTotalPercent > 100" class="mt-1 text-xs text-warning">
                投入比例合计不能超过 100%。
              </p>
            </UFormField>

            <UFormField label="工作说明">
              <UTextarea
                v-model="form.description"
                class="w-full"
                placeholder="填写当天主要工作内容"
                :rows="3"
              />
            </UFormField>
          </div>
        </template>

        <template #footer="{ close }">
          <UButton
            label="取消"
            color="neutral"
            variant="outline"
            @click="close"
          />
          <UButton
            label="提交"
            icon="i-lucide-check"
            color="primary"
            :loading="submitting"
            :disabled="reportSubmitDisabled"
            @click="submitTimeEntry"
          />
        </template>
      </UModal>

      <UModal v-model:open="detailModalOpen" :title="`查看/修改工时 · ${selectedDate}`" :ui="{ content: 'sm:max-w-3xl', body: 'p-0' }">
        <template #body>
          <div class="space-y-4 p-4">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <UBadge color="primary" variant="subtle">
                {{ detailTotalHours.toFixed(1) }}h
              </UBadge>
              <UBadge color="neutral" variant="subtle">
                {{ detailRows.length }} 个项目行
              </UBadge>
              <UBadge v-if="changedDetailRows.length > 0" color="warning" variant="subtle">
                已修改 {{ changedDetailRows.length }} 条
              </UBadge>
            </div>

            <div v-if="detailRows.length === 0" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
              暂无工时记录
            </div>

            <div v-else class="max-h-[56vh] overflow-y-auto rounded-lg border border-default">
              <div
                v-for="row in detailRows"
                :key="row.key"
                class="grid gap-3 border-b border-default px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(14rem,1fr)] lg:items-start"
              >
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-highlighted">
                    {{ row.projectName }}
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span class="font-mono">{{ row.projectCode }}</span>
                    <span v-if="row.itemKey">{{ row.itemKey }}</span>
                  </div>
                  <div v-if="row.itemTitle" class="mt-1 truncate text-xs text-muted">
                    {{ row.itemTitle }}
                  </div>
                </div>

                <UFormField label="工时">
                  <UInput
                    v-model.number="row.hours"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="工作说明">
                  <UTextarea
                    v-model="row.description"
                    :rows="2"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </div>

            <p v-if="detailTotalHours > 24" class="text-xs text-warning">
              单日工时合计不能超过 24 小时。
            </p>
          </div>
        </template>

        <template #footer="{ close }">
          <UButton
            label="关闭"
            color="neutral"
            variant="outline"
            @click="close"
          />
          <UButton
            label="保存修改"
            icon="i-lucide-save"
            color="primary"
            :loading="detailSubmitting"
            :disabled="detailSubmitDisabled"
            @click="submitDetailChanges"
          />
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
