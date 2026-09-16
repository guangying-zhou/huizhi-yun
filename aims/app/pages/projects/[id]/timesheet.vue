<script setup lang="ts">
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

// 视图切换
const activeView = ref<'project' | 'mine'>('project')

// 日期范围
const today = new Date()
const startDate = ref(formatDate(today))
const endDate = ref(formatDate(today))

function getMonday(d: Date) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  return formatDate(date)
}

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function normalizeDateOnly(value: string | null | undefined) {
  if (!value) return ''
  return value.slice(0, 10)
}

function initializeDateRangeFromProject() {
  const projectStart = normalizeDateOnly(projectStore.currentProject?.startDate)
  startDate.value = projectStart || formatDate(today)
  endDate.value = formatDate(today)
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
}

type ListPayload<T> = T[] | {
  items?: T[]
}

const entries = ref<TimeEntry[]>([])
const loading = ref(false)
const initialized = ref(false)
const reviewAnchorDate = ref(formatDate(today))
const reviewEntries = ref<ReviewTimeEntry[]>([])
const reviewLoading = ref(false)
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
    projectName: entry.projectName ?? entry.project_name
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
  if (!canReviewTimesheet.value || !projectId.value) {
    reviewEntries.value = []
    selectedReviewEntryIds.value = []
    return
  }
  reviewLoading.value = true
  try {
    const response = await $fetch<{ code: number, data: { items?: ReviewTimeEntry[] } }>(
      `/api/v1/projects/${projectId.value}/time-entry-reviews?periodKey=${encodeURIComponent(reviewPeriodKey.value)}`
    )
    reviewEntries.value = response.data.items || []
    selectedReviewEntryIds.value = selectedReviewEntryIds.value.filter(id =>
      reviewEntries.value.some(entry => entry.id === id && entry.reviewStatus === 'submitted')
    )
  } catch (err: unknown) {
    console.error('加载待审核工时失败', err)
    reviewEntries.value = []
    selectedReviewEntryIds.value = []
    const message = (err as { data?: { message?: string } })?.data?.message || '待审核工时加载失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    reviewLoading.value = false
  }
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
  if (selectedReviewCount.value === 0) return
  reviewAction.value = action
  reviewReason.value = ''
  reviewModalOpen.value = true
}

async function submitReviewDecision() {
  if (selectedReviewCount.value === 0) return
  if (reviewAction.value === 'return' && !reviewReason.value.trim()) {
    toast.add({ title: '退回时必须填写原因', color: 'warning' })
    return
  }
  reviewSubmitting.value = true
  try {
    const url = `/api/v1/projects/${projectId.value}/time-entry-reviews` as string
    await $fetch(url, {
      method: 'POST',
      body: {
        action: reviewAction.value,
        entryIds: selectedReviewEntryIds.value,
        reason: reviewReason.value.trim() || undefined
      }
    })
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
    const message = (err as { data?: { message?: string } })?.data?.message || '工时审核失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    reviewSubmitting.value = false
  }
}

async function loadEntries() {
  loading.value = true
  try {
    if (activeView.value === 'project') {
      const params = new URLSearchParams()
      if (startDate.value) params.set('startDate', startDate.value)
      if (endDate.value) params.set('endDate', endDate.value)
      const { data } = await $fetch<{ code: number, data: ListPayload<RawTimeEntry> }>(
        `/api/v1/projects/${projectId.value}/time-entries?${params.toString()}`
      )
      entries.value = normalizeTimeEntries(data)
    } else {
      const params = new URLSearchParams()
      if (startDate.value) params.set('startDate', startDate.value)
      if (endDate.value) params.set('endDate', endDate.value)
      const { data } = await $fetch<{ code: number, data: ListPayload<RawTimeEntry> }>(
        `/api/v1/users/${currentUid.value}/time-entries?${params.toString()}`
      )
      // 筛选当前项目
      entries.value = normalizeTimeEntries(data).filter(e => e.projectId === projectId.value)
    }
  } catch (err) {
    console.error('加载工时记录失败', err)
    entries.value = []
  } finally {
    loading.value = false
  }
}

// 统计
const totalHours = computed(() => {
  return entries.value.reduce((sum, e) => sum + Number(e.hours), 0)
})

const todayHours = computed(() => {
  const todayStr = formatDate(new Date())
  return entries.value
    .filter(e => e.entryDate?.slice(0, 10) === todayStr)
    .reduce((sum, e) => sum + Number(e.hours), 0)
})

const weekHours = computed(() => {
  const monday = getMonday(new Date())
  const sundayDate = new Date()
  sundayDate.setDate(sundayDate.getDate() + (7 - sundayDate.getDay()))
  const sunday = formatDate(sundayDate)
  return entries.value
    .filter((e) => {
      const d = e.entryDate?.slice(0, 10)
      return d && d >= monday && d <= sunday
    })
    .reduce((sum, e) => sum + Number(e.hours), 0)
})

// 项目工时表格列
const projectColumns = [
  { accessorKey: 'entryDate', header: '日期' },
  { accessorKey: 'itemKey', header: '工作项' },
  { accessorKey: 'itemTitle', header: '标题' },
  { accessorKey: 'uid', header: '记录人' },
  { accessorKey: 'hours', header: '工时(h)' },
  { accessorKey: 'description', header: '描述' }
]

// 我的工时表格列（无记录人）
const myColumns = [
  { accessorKey: 'entryDate', header: '日期' },
  { accessorKey: 'itemKey', header: '工作项' },
  { accessorKey: 'itemTitle', header: '标题' },
  { accessorKey: 'hours', header: '工时(h)' },
  { accessorKey: 'description', header: '描述' }
]

const currentColumns = computed(() => {
  return activeView.value === 'project' ? projectColumns : myColumns
})

// 记录工时弹窗
const showLogModal = ref(false)
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
        `/api/v1/projects/${projectId.value}/work-items?search=${encodeURIComponent(keyword)}&pageSize=100&tier=target`
      ),
      $fetch<{ code: number, data: { items: Array<{ id: number, itemKey: string }> } }>(
        `/api/v1/projects/${projectId.value}/work-items?search=${encodeURIComponent(keyword)}&pageSize=100&tier=matter`
      )
    ])
    const candidates = [
      ...(targetRes.data?.items || []),
      ...(matterRes.data?.items || [])
    ]
    const matchItem = candidates.find(i => i.itemKey === keyword)
    if (!matchItem) {
      alert('未找到匹配的工作项，请检查编号')
      return
    }

    await $fetch(`/api/v1/work-items/${matchItem.id}/time-entries`, {
      method: 'POST',
      body: {
        entryDate: logForm.value.entryDate,
        hours: Number(logForm.value.hours),
        description: logForm.value.description || undefined
      }
    })

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
    alert('记录工时失败')
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

watch([activeView, startDate, endDate], () => {
  if (!initialized.value) return
  void loadEntries()
})

watch(reviewAnchorDate, () => {
  if (!initialized.value) return
  void loadReviewQueue()
})
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
                {{ totalHours.toFixed(1) }}h
              </div>
            </div>
            <div class="bg-elevated rounded-lg p-4">
              <div class="text-sm text-muted">
                本周工时
              </div>
              <div class="text-2xl font-bold mt-1">
                {{ weekHours.toFixed(1) }}h
              </div>
            </div>
            <div class="bg-elevated rounded-lg p-4">
              <div class="text-sm text-muted">
                今日工时
              </div>
              <div class="text-2xl font-bold mt-1">
                {{ todayHours.toFixed(1) }}h
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
                    {{ pendingReviewEntries.length }} 条待审核
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
                  label="全选待审核"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :disabled="pendingReviewEntries.length === 0"
                  @click="toggleAllPendingReviews"
                />
              </div>
            </div>

            <div v-if="reviewLoading" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
            </div>
            <div v-else-if="reviewEntries.length === 0" class="px-4 py-8 text-center text-sm text-muted">
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
                  :disabled="entry.reviewStatus !== 'submitted'"
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
              <div class="flex gap-2">
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

          <!-- 加载中 -->
          <div v-if="loading" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-muted" />
          </div>

          <!-- 空状态 -->
          <div v-else-if="entries.length === 0" class="text-center py-12 text-muted">
            <UIcon name="i-lucide-clock" class="w-12 h-12 mx-auto mb-3" />
            <p>暂无工时记录</p>
          </div>

          <!-- 工时表格 -->
          <UTable
            v-else
            :data="entries"
            :columns="currentColumns"
            class="w-full"
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
            <template #description-cell="{ row }">
              <span class="text-sm text-muted truncate max-w-xs inline-block">{{ row.original.description || '-' }}</span>
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
