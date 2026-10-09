<script setup lang="ts">
import CommonEmptyState from '../../../../../foundation/app/components/common/EmptyState.vue'
import { useAimsModule } from '../../../../layer/useAimsModule'
import { useTimeEntryPage, useTimeEntryReadPage } from '../../../composables/useTimeEntryPage'
import { projectTimeWeekWindow, isTimeEntryReviewPage, type TimeEntryReviewPage } from '../../../utils/timeEntryPagination'
import { useProjectStore } from '../../../stores/project'
import { createCommandIntents } from '../../../utils/commandIntent'
import { isTimeEntryReviewVersionConflict, timeEntryReviewErrorMessage } from '../../../utils/timeEntryReviewError'
import { reviewStatusLabel as entryStatusLabel, reviewStatusColor as entryStatusColor, defaultTimesheetRange, type TimeEntryReviewStatus } from '../../../utils/timeEntryPresentation'
import ProjectNavbar from '../../../components/project/ProjectNavbar.vue'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl, hosted } = useAimsModule()
const workTimeIntents = createCommandIntents()
const reviewIntents = createCommandIntents()
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '工时统计',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const projectStore = useProjectStore()
const { users: accountUsers } = useAccountUsers()
const { isApprovalMode } = useApprovalMode()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const toast = useToast()

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    if (u.realName?.trim()) map.set(u.uid, u.realName.trim())
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return userNameMap.value.get(uid) || uid
}

// 当前用户
const { user: authUser } = useAuth()
const currentUid = computed(() => authUser.value || '')
const currentProject = computed(() => projectStore.currentProject)
const canLogTime = computed(() => {
  const project = currentProject.value
  if (!project || !currentUid.value) return false
  return project.leaderUid === currentUid.value
    || project.currentUserRole === 'manager'
    || project.currentUserRole === 'member'
})
const canReviewTimesheet = computed(() =>
  permissionsLoaded.value
  && (hasPermission('timesheet', 'approve') || hasPermission('timesheet', 'submit'))
)
const canDecideTimesheet = computed(() => permissionsLoaded.value && hasPermission('timesheet', 'approve'))

// 视图切换
const activeView = ref<'project' | 'mine'>('project')

// 日期范围
const today = new Date()
const startDate = ref(projectTimeWeekWindow(today).todayDate)
const endDate = ref(projectTimeWeekWindow(today).todayDate)

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

// 默认展示本周（与页头“本周工时”口径一致）；需要更长区间时可手动调整日期。
function initializeDateRangeFromProject() {
  const range = defaultTimesheetRange(new Date(), reportingTimezone.value)
  startDate.value = range.startDate
  endDate.value = range.endDate
}

// 数据
interface TimeEntry {
  id: number
  workItemId: number | null
  itemKey: string
  itemTitle: string
  uid: string
  entryDate: string
  hours: number
  description: string | null
  createdAt?: string
  updatedAt?: string
  projectId?: number
  projectName?: string
  reviewStatus: TimeEntryReviewStatus
}

interface ReviewTimeEntry {
  id: number
  uid: string
  entryDate: string
  hours: number | string
  description: string | null
  itemKey: string | null
  itemTitle: string | null
  reviewStatus: 'submitted' | 'approved' | 'returned'
  rowVersion: number
  submittedAt: string | null
}

interface RawTimeEntry {
  id: number
  workItemId?: number | null
  work_item_id?: number | null
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
  projectId?: number
  project_id?: number
  projectName?: string
  project_name?: string
  reviewStatus?: string
  review_status?: string
}

type ListPayload<T> = T[] | {
  items?: T[]
}

const entryRead = useTimeEntryPage<RawTimeEntry>()
const reportingTimezone = ref('Asia/Shanghai')
const entries = computed(() => normalizeTimeEntries(entryRead.data.value?.items))
const loading = entryRead.loading
const entryTotal = computed(() => entryRead.data.value?.total || 0)
const { page: entryPage, pageSize: entryPageSize } = useListPage({ pageSize: 20, syncUrl: false })
const initialized = ref(false)
const reviewAnchorDate = ref(projectTimeWeekWindow(today).todayDate)
const reviewRead = useTimeEntryReadPage<TimeEntryReviewPage<ReviewTimeEntry>>((value, page, size): value is TimeEntryReviewPage<ReviewTimeEntry> => isTimeEntryReviewPage<ReviewTimeEntry>(value, page, size) && value.periodKey === reviewPeriodKey.value)
const reviewEntries = computed(() => reviewRead.data.value?.items || [])
const reviewLoading = reviewRead.loading
const reviewTotal = computed(() => reviewRead.data.value?.total || 0)
const reviewPendingTotal = computed(() => reviewRead.data.value?.statusCounts.submitted || 0)
const { page: reviewPage, pageSize: reviewPageSize } = useListPage({ pageSize: 20, syncUrl: false })
const reviewSubmitting = ref(false)
const selectedReviewEntryIds = ref<number[]>([])
const reviewModalOpen = ref(false)
const reviewAction = ref<'approve' | 'return'>('approve')
const reviewReason = ref('')
const reviewPeriodKey = computed(() => isoPeriodKey(reviewAnchorDate.value))
const reviewWeekRange = computed(() => isoWeekRange(reviewAnchorDate.value))
const pendingReviewEntries = computed(() => reviewEntries.value.filter(entry => entry.reviewStatus === 'submitted'))
const selectedReviewCount = computed(() => selectedReviewEntryIds.value.length)

function normalizeListPayload<T>(data: ListPayload<T> | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function normalizeEntryStatus(value: string | undefined): TimeEntryReviewStatus {
  return value === 'submitted' || value === 'approved' || value === 'returned' ? value : 'draft'
}

function normalizeTimeEntries(rawEntries: ListPayload<RawTimeEntry> | null | undefined): TimeEntry[] {
  return normalizeListPayload(rawEntries).map(entry => ({
    id: Number(entry.id),
    workItemId: entry.workItemId ?? entry.work_item_id ?? null,
    itemKey: entry.itemKey || entry.item_key || '项目级',
    itemTitle: entry.itemTitle || entry.item_title || entry.title || '项目级工时',
    uid: entry.uid,
    entryDate: entry.entryDate || entry.entry_date || '',
    hours: Number(entry.hours || 0),
    description: entry.description || null,
    createdAt: entry.createdAt || entry.created_at,
    updatedAt: entry.updatedAt || entry.updated_at,
    projectId: entry.projectId ?? entry.project_id,
    projectName: entry.projectName ?? entry.project_name,
    reviewStatus: normalizeEntryStatus(entry.reviewStatus ?? entry.review_status)
  }))
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year || 1970, (month || 1) - 1, day || 1, 12)
}

function isoPeriodKey(value: string) {
  const source = dateFromKey(value)
  const utc = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()))
  const weekday = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday)
  const isoYear = utc.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

function isoWeekRange(value: string) {
  const source = dateFromKey(value)
  const weekday = source.getDay() || 7
  const monday = new Date(source)
  monday.setDate(monday.getDate() + 1 - weekday)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return { start: formatDate(monday), end: formatDate(sunday) }
}

function reviewStatusLabel(status: ReviewTimeEntry['reviewStatus']) {
  if (status === 'approved') return '已确认'
  if (status === 'returned') return '已退回'
  return '待审核'
}

function reviewStatusColor(status: ReviewTimeEntry['reviewStatus']): 'warning' | 'success' | 'error' {
  if (status === 'approved') return 'success'
  if (status === 'returned') return 'error'
  return 'warning'
}

async function loadReviewQueue() {
  selectedReviewEntryIds.value = []
  if (!canReviewTimesheet.value || !projectId.value) {
    reviewRead.clear()
    return
  }
  const data = await reviewRead.read(moduleUrl(`/api/v1/projects/${projectId.value}/time-entry-reviews`), {
    periodKey: reviewPeriodKey.value, page: reviewPage.value, pageSize: reviewPageSize
  })
  if (data && !data.items.length && reviewPage.value > 1) reviewPage.value = Math.max(1, Math.ceil(data.total / reviewPageSize))
}

function toggleReviewEntry(id: number, selected: boolean | 'indeterminate') {
  if (selected === true) {
    if (!selectedReviewEntryIds.value.includes(id)) selectedReviewEntryIds.value = [...selectedReviewEntryIds.value, id]
    return
  }
  selectedReviewEntryIds.value = selectedReviewEntryIds.value.filter(entryId => entryId !== id)
}

function toggleAllPendingReviews() {
  const pendingIds = pendingReviewEntries.value.map(entry => entry.id)
  const allSelected = pendingIds.length > 0 && pendingIds.every(id => selectedReviewEntryIds.value.includes(id))
  selectedReviewEntryIds.value = allSelected ? [] : pendingIds
}

function openReviewConfirmation(action: 'approve' | 'return') {
  if (!canDecideTimesheet.value) return
  if (selectedReviewCount.value === 0) return
  reviewAction.value = action
  reviewReason.value = ''
  reviewModalOpen.value = true
}

async function submitReviewDecision() {
  if (!canDecideTimesheet.value) return
  if (selectedReviewCount.value === 0) return
  if (reviewAction.value === 'return' && !reviewReason.value.trim()) {
    toast.add({ title: '退回时必须填写原因', color: 'warning' })
    return
  }
  reviewSubmitting.value = true
  try {
    const url = moduleUrl(`/api/v1/projects/${projectId.value}/time-entry-reviews`) as string
    const selected = reviewEntries.value.filter(entry => selectedReviewEntryIds.value.includes(entry.id) && entry.reviewStatus === 'submitted').sort((a, b) => a.id - b.id)
    if (selected.length !== selectedReviewEntryIds.value.length) throw new Error('审核记录已变化，请重新加载')
    const body = hosted
      ? { action: reviewAction.value, entries: selected.map(entry => ({ id: entry.id, rowVersion: entry.rowVersion })), reason: reviewAction.value === 'return' ? reviewReason.value.trim() : '' }
      : { action: reviewAction.value, entryIds: selectedReviewEntryIds.value, reason: reviewReason.value.trim() || undefined }
    const intent = `review:${projectId.value}:${reviewAction.value}`
    await $fetch(url, {
      method: 'POST',
      body,
      ...(hosted ? { headers: reviewIntents.headers(intent, body), retry: 0 } : {})
    })
    if (hosted) reviewIntents.complete(intent)
    toast.add({
      title: reviewAction.value === 'approve'
        ? `已确认 ${selectedReviewCount.value} 条工时`
        : `已退回 ${selectedReviewCount.value} 条工时`,
      color: 'success'
    })
    reviewModalOpen.value = false
    selectedReviewEntryIds.value = []
    await Promise.all([loadReviewQueue(), loadEntries()])
  } catch (err: unknown) {
    console.error('审核工时失败', err)
    const message = timeEntryReviewErrorMessage(err) || (err as { data?: { message?: string } })?.data?.message || '工时审核失败'
    toast.add({ title: message, color: 'error' })
    if (isTimeEntryReviewVersionConflict(err)) {
      reviewModalOpen.value = false
      selectedReviewEntryIds.value = []
      await Promise.allSettled([loadReviewQueue(), loadEntries()])
    }
  } finally {
    reviewSubmitting.value = false
  }
}

async function loadEntries() {
  if (!currentUid.value || !projectId.value) {
    entryRead.clear()
    return
  }
  const path = activeView.value === 'project' ? moduleUrl(`/api/v1/projects/${projectId.value}/time-entries`) : moduleUrl(`/api/v1/users/${encodeURIComponent(currentUid.value)}/time-entries`)
  const data = await entryRead.read(path, {
    startDate: startDate.value || undefined, endDate: endDate.value || undefined,
    projectId: activeView.value === 'mine' ? String(projectId.value) : undefined,
    page: entryPage.value, pageSize: entryPageSize, ...projectTimeWeekWindow(new Date(), reportingTimezone.value)
  })
  if (data?.calendarTimezone && data.calendarTimezone !== reportingTimezone.value) {
    const previousToday = projectTimeWeekWindow(new Date(), reportingTimezone.value).todayDate
    const previousRange = defaultTimesheetRange(new Date(), reportingTimezone.value)
    reportingTimezone.value = data.calendarTimezone
    const currentRange = defaultTimesheetRange(new Date(), reportingTimezone.value)
    if (startDate.value === previousRange.startDate && endDate.value === previousRange.endDate) {
      startDate.value = currentRange.startDate
      endDate.value = currentRange.endDate
    }
    const currentToday = projectTimeWeekWindow(new Date(), reportingTimezone.value).todayDate
    if (reviewAnchorDate.value === previousToday) reviewAnchorDate.value = currentToday
    await loadEntries()
    return
  }
  if (data && !data.items.length && entryPage.value > 1) {
    entryPage.value = Math.max(1, Math.ceil(data.total / entryPageSize))
  }
}

// Complete authorized/windowed aggregates, independent of the visible page.
const totalHours = computed(() => entryRead.data.value?.summary.totalHours || 0)
const todayHours = computed(() => entryRead.data.value?.summary.todayHours || 0)
const weekHours = computed(() => entryRead.data.value?.summary.weekHours || 0)

// 项目工时表格列
const projectColumns = [
  { accessorKey: 'entryDate', header: '日期' },
  { accessorKey: 'itemKey', header: '工作项' },
  { accessorKey: 'itemTitle', header: '标题' },
  { accessorKey: 'uid', header: '记录人' },
  { accessorKey: 'hours', header: '工时(h)' },
  { accessorKey: 'reviewStatus', header: '状态' },
  { accessorKey: 'description', header: '描述' }
]

// 我的工时表格列（无记录人）
const myColumns = [
  { accessorKey: 'entryDate', header: '日期' },
  { accessorKey: 'itemKey', header: '工作项' },
  { accessorKey: 'itemTitle', header: '标题' },
  { accessorKey: 'hours', header: '工时(h)' },
  { accessorKey: 'reviewStatus', header: '状态' },
  { accessorKey: 'description', header: '描述' }
]

const currentColumns = computed(() => {
  return activeView.value === 'project' ? projectColumns : myColumns
})

// 记录工时弹窗
const showLogModal = ref(false)
watch(showLogModal, (open) => {
  if (!open) workTimeIntents.clear()
})
const submitting = ref(false)
const logForm = ref({
  itemKey: '',
  entryDate: formatDate(new Date()),
  hours: 1,
  description: ''
})

async function handleLogTime() {
  if (!logForm.value.itemKey) return
  submitting.value = true
  try {
    const keyword = logForm.value.itemKey.trim()
    const [targetRes, matterRes] = await Promise.all([
      $fetch<{ code: number, data: { items: Array<{ id: number, itemKey: string }> } }>(
        moduleUrl(`/api/v1/projects/${projectId.value}/work-items?search=${encodeURIComponent(keyword)}&pageSize=100&tier=target`)
      ),
      $fetch<{ code: number, data: { items: Array<{ id: number, itemKey: string }> } }>(
        moduleUrl(`/api/v1/projects/${projectId.value}/work-items?search=${encodeURIComponent(keyword)}&pageSize=100&tier=matter`)
      )
    ])
    const candidates = [
      ...(targetRes.data?.items || []),
      ...(matterRes.data?.items || [])
    ]
    const matchItem = candidates.find(i => i.itemKey === keyword)
    if (!matchItem) {
      toast.add({ title: '未找到工作项', description: '请检查工作项编号是否属于当前项目。', color: 'warning' })
      return
    }

    const body = { entryDate: logForm.value.entryDate, hours: Number(logForm.value.hours), description: logForm.value.description || undefined }
    const intent = `create:${matchItem.id}`
    await $fetch(moduleUrl(`/api/v1/work-items/${matchItem.id}/time-entries`), {
      method: 'POST',
      body, headers: workTimeIntents.headers(intent, body), retry: 0
    })
    workTimeIntents.complete(intent)

    showLogModal.value = false
    logForm.value = {
      itemKey: '',
      entryDate: formatDate(new Date()),
      hours: 1,
      description: ''
    }
    await loadEntries()
  } catch (err) {
    console.error('记录工时失败', err)
    toast.add({ title: '记录工时失败', description: '工时未确认保存，请检查网络后重试。', color: 'error' })
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const permissionsRequest = permissionsLoaded.value ? Promise.resolve() : loadPermissions()
  const projectRequest = !projectStore.currentProject || projectStore.currentProject.id !== projectId.value
    ? projectStore.fetchProject(projectId.value)
    : Promise.resolve()
  await Promise.all([permissionsRequest, projectRequest])
  initializeDateRangeFromProject()
  await Promise.all([loadEntries(), loadReviewQueue()])
  initialized.value = true
})

watch([activeView, startDate, endDate, projectId], () => {
  entryRead.clear()
  entryPage.value = 1
  if (!initialized.value) return
  void loadEntries()
}, { flush: 'sync' })
watch(entryPage, () => {
  if (initialized.value) void loadEntries()
}, {
  flush: 'sync'
})
watch(entryRead.fingerprint, () => {
  if (initialized.value && entryRead.fingerprint.value) void loadEntries()
}, {
  flush: 'sync'
})

watch([reviewAnchorDate, projectId, canReviewTimesheet], () => {
  reviewRead.clear()
  selectedReviewEntryIds.value = []
  reviewPage.value = 1
  if (!initialized.value) return
  void loadReviewQueue()
}, { flush: 'sync' })
watch(reviewPage, () => {
  if (initialized.value) void loadReviewQueue()
})
watch(reviewRead.fingerprint, () => {
  selectedReviewEntryIds.value = []
  reviewModalOpen.value = false
  if (initialized.value && reviewRead.fingerprint.value) void loadReviewQueue()
}, { flush: 'sync' })
</script>

<template>
  <UDashboardPanel id="project-timesheet" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar>
          <template v-if="!isApprovalMode && canLogTime" #actions>
            <UButton
              icon="i-lucide-clock"
              label="记录工时"
              color="primary"
              size="sm"
              @click="showLogModal = true"
            />
          </template>
        </ProjectNavbar>
        <div class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-12 space-y-4">
          <!-- 统计卡片 -->
          <div class="grid grid-cols-3 gap-4">
            <div class="bg-elevated rounded-lg p-4">
              <div class="text-sm text-muted">
                总工时
              </div>
              <div class="text-2xl font-bold mt-1">
                {{ entryRead.data.value ? `${totalHours.toFixed(1)}h` : '—' }}
              </div>
            </div>
            <div class="bg-elevated rounded-lg p-4">
              <div class="text-sm text-muted">
                本周工时
              </div>
              <div class="text-2xl font-bold mt-1">
                {{ entryRead.data.value ? `${weekHours.toFixed(1)}h` : '—' }}
              </div>
            </div>
            <div class="bg-elevated rounded-lg p-4">
              <div class="text-sm text-muted">
                今日工时
              </div>
              <div class="text-2xl font-bold mt-1">
                {{ entryRead.data.value ? `${todayHours.toFixed(1)}h` : '—' }}
              </div>
            </div>
          </div>

          <section v-if="canReviewTimesheet" class="rounded-lg border border-default bg-default">
            <div class="flex flex-col gap-3 border-b border-default p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="font-semibold text-highlighted">
                    待我审核的成员工时
                  </h2>
                  <UBadge color="warning" variant="subtle">
                    {{ reviewPendingTotal }} 条待审核
                  </UBadge>
                </div>
                <p class="mt-1 text-xs text-muted">
                  仅显示在填报日期由你作为项目经理或代理负责人审核的工时。
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <UInput
                  v-model="reviewAnchorDate"
                  type="date"
                  aria-label="选择审核周"
                  class="w-36"
                />
                <UBadge color="neutral" variant="subtle">
                  {{ reviewPeriodKey }} · {{ reviewWeekRange.start }} 至 {{ reviewWeekRange.end }}
                </UBadge>
                <UButton
                  v-if="canDecideTimesheet"
                  label="全选待审核"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :disabled="pendingReviewEntries.length === 0"
                  @click="toggleAllPendingReviews"
                />
              </div>
            </div>

            <UAlert
              v-if="reviewRead.error.value"
              color="error"
              title="审核队列加载失败"
              description="当前统计不可用，请重新加载。"
            />
            <UButton v-if="reviewRead.error.value" label="重新加载" @click="loadReviewQueue()" />
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
              <span class="text-sm text-muted">共 {{ reviewTotal }} 条</span>
              <UPagination
                v-model:page="reviewPage"
                :total="reviewTotal"
                :items-per-page="reviewPageSize"
                :disabled="reviewLoading"
              />
            </div>
            <div v-if="reviewLoading" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
            </div>
            <div v-else-if="!reviewRead.error.value && reviewEntries.length === 0" class="px-4 py-8 text-center text-sm text-muted">
              本周没有分派给你的成员工时
            </div>
            <div v-else class="divide-y divide-default">
              <div
                v-for="entry in reviewEntries"
                :key="entry.id"
                class="grid gap-3 px-4 py-3 lg:grid-cols-[2rem_8rem_8rem_minmax(0,1fr)_6rem] lg:items-center"
              >
                <UCheckbox
                  :model-value="selectedReviewEntryIds.includes(entry.id)"
                  :disabled="!canDecideTimesheet || entry.reviewStatus !== 'submitted'"
                  :aria-label="`选择 ${getUserName(entry.uid)} ${entry.entryDate} 的工时`"
                  @update:model-value="toggleReviewEntry(entry.id, $event)"
                />
                <div>
                  <div class="text-sm font-medium text-highlighted">
                    {{ getUserName(entry.uid) }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ entry.entryDate }}
                  </div>
                </div>
                <div>
                  <div class="font-semibold text-highlighted">
                    {{ Number(entry.hours).toFixed(1) }}h
                  </div>
                  <UBadge :color="reviewStatusColor(entry.reviewStatus)" variant="subtle" size="xs">
                    {{ reviewStatusLabel(entry.reviewStatus) }}
                  </UBadge>
                </div>
                <div class="min-w-0">
                  <div v-if="entry.itemKey || entry.itemTitle" class="truncate text-sm text-highlighted">
                    <span v-if="entry.itemKey" class="mr-2 font-mono text-xs text-primary">{{ entry.itemKey }}</span>
                    {{ entry.itemTitle || '' }}
                  </div>
                  <p class="truncate text-sm text-muted">
                    {{ entry.description || '未填写工作说明' }}
                  </p>
                </div>
                <div class="text-right text-xs text-muted">
                  #{{ entry.id }}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default p-4">
              <p class="text-sm text-muted">
                已选择 {{ selectedReviewCount }} 条
              </p>
              <div v-if="canDecideTimesheet" class="flex gap-2">
                <UButton
                  label="退回修改"
                  icon="i-lucide-undo-2"
                  color="error"
                  variant="soft"
                  :disabled="selectedReviewCount === 0"
                  @click="openReviewConfirmation('return')"
                />
                <UButton
                  label="确认工时"
                  icon="i-lucide-check"
                  color="primary"
                  :disabled="selectedReviewCount === 0"
                  @click="openReviewConfirmation('approve')"
                />
              </div>
            </div>
          </section>

          <!-- 视图切换 + 日期筛选 -->
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex rounded-lg overflow-hidden border border-default">
              <button
                class="px-3 py-1.5 text-sm font-medium transition-colors"
                :class="activeView === 'project' ? 'bg-primary text-white' : 'bg-default text-muted hover:text-default'"
                @click="activeView = 'project'"
              >
                项目工时
              </button>
              <button
                class="px-3 py-1.5 text-sm font-medium transition-colors"
                :class="activeView === 'mine' ? 'bg-primary text-white' : 'bg-default text-muted hover:text-default'"
                @click="activeView = 'mine'"
              >
                我的工时
              </button>
            </div>
            <UInput v-model="startDate" type="date" class="w-40" />
            <span class="text-muted">至</span>
            <UInput v-model="endDate" type="date" class="w-40" />
          </div>

          <UAlert
            v-if="entryRead.error.value"
            color="error"
            title="工时记录加载失败"
            description="统计和明细暂不可用，请重试。"
          />
          <UButton
            v-if="entryRead.error.value"
            label="重新加载"
            color="neutral"
            variant="outline"
            @click="loadEntries()"
          />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ entryTotal }} 条</span>
            <UPagination
              v-model:page="entryPage"
              :total="entryTotal"
              :items-per-page="entryPageSize"
              :disabled="loading"
            />
          </div>
          <!-- 工时表格 -->
          <UTable
            :data="entries"
            :columns="currentColumns"
            class="w-full"
            :loading="loading"
          >
            <template #entryDate-cell="{ row }">
              {{ row.original.entryDate?.slice(0, 10) || '-' }}
            </template>
            <template #itemKey-cell="{ row }">
              <span class="font-mono text-xs text-primary">{{ row.original.itemKey }}</span>
            </template>
            <template #itemTitle-cell="{ row }">
              <span class="truncate max-w-xs inline-block">{{ row.original.itemTitle || '-' }}</span>
            </template>
            <template #uid-cell="{ row }">
              {{ getUserName(row.original.uid) }}
            </template>
            <template #hours-cell="{ row }">
              <span class="font-medium">{{ Number(row.original.hours).toFixed(1) }}</span>
            </template>
            <template #reviewStatus-cell="{ row }">
              <UBadge :color="entryStatusColor(row.original.reviewStatus)" variant="soft" size="sm">
                {{ entryStatusLabel(row.original.reviewStatus) }}
              </UBadge>
            </template>
            <template #description-cell="{ row }">
              <span class="text-sm text-muted truncate max-w-xs inline-block">{{ row.original.description || '-' }}</span>
            </template>
            <template #empty>
              <CommonEmptyState icon="i-lucide-clock" title="暂无工时记录" description="当前期间没有可显示的工时记录。" />
            </template>
          </UTable>

          <!-- 记录工时弹窗 -->
          <UModal v-model:open="showLogModal">
            <template #header>
              <h3 class="text-lg font-semibold">
                记录工时
              </h3>
            </template>
            <template #body>
              <div class="space-y-4 p-4">
                <UFormField label="工作项编号" required>
                  <UInput v-model="logForm.itemKey" placeholder="输入工作项编号，如 PROJ-1" class="w-full" />
                </UFormField>
                <UFormField label="日期" required>
                  <UInput v-model="logForm.entryDate" type="date" class="w-full" />
                </UFormField>
                <UFormField label="工时（小时）" required>
                  <UInput
                    v-model.number="logForm.hours"
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="24"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="描述">
                  <UTextarea v-model="logForm.description" placeholder="工作内容描述" class="w-full" />
                </UFormField>
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  @click="showLogModal = false"
                />
                <UButton
                  label="提交"
                  color="primary"
                  :loading="submitting"
                  @click="handleLogTime"
                />
              </div>
            </template>
          </UModal>

          <UModal
            v-if="canDecideTimesheet"
            v-model:open="reviewModalOpen"
            :title="reviewAction === 'approve' ? '确认成员工时' : '退回成员工时'"
          >
            <template #body>
              <div class="space-y-4 p-4">
                <p class="text-sm text-highlighted">
                  将{{ reviewAction === 'approve' ? '确认' : '退回' }}已选择的 {{ selectedReviewCount }} 条工时。
                </p>
                <UFormField
                  v-if="reviewAction === 'return'"
                  label="退回原因"
                  required
                  description="退回后，填报人可以修改并重新提交。"
                >
                  <UTextarea
                    v-model="reviewReason"
                    :rows="3"
                    class="w-full"
                    placeholder="请说明需要修改的内容"
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
                :label="reviewAction === 'approve' ? '确认通过' : '确认退回'"
                :icon="reviewAction === 'approve' ? 'i-lucide-check' : 'i-lucide-undo-2'"
                :color="reviewAction === 'approve' ? 'primary' : 'error'"
                :loading="reviewSubmitting"
                :disabled="reviewAction === 'return' && !reviewReason.trim()"
                @click="submitReviewDecision"
              />
            </template>
          </UModal>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
