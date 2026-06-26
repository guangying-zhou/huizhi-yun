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
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  initializeDateRangeFromProject()
  await loadEntries()
})

watch([activeView, startDate, endDate], () => {
  loadEntries()
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
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
