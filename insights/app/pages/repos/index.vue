<script setup lang="ts">
import ScanLogsAndStats from '~/components/repoinsight/ingestion/ScanLogsAndStats.vue'
import type {
  Department,
  IngestionRun,
  IngestionRunLog,
  RepoSummary
} from '~/types/repoinsight'
import { formatDate, extractErrorMessage, stripSubseconds } from '~/utils/log'
import { useScanStatus, type ScanStatus } from '~/composables/useScanStatus'

const { apiBase } = useApiBase()

const filters = reactive({
  repoSourceId: 0,
  search: '',
  validOnly: false, // Changed to false to show invalid repos by default
  deptId: 0
})

const toast = useToast()
const { scanStatusColor, scanStatusLabel } = useScanStatus()

// Track component lifecycle to prevent operations after unmount
const isMounted = ref(true)

interface ReposResponse {
  data: RepoSummary[]
  meta: {
    page: number
    pageSize: number
    total: number
  }
}

const repos = ref<RepoSummary[]>([])
const totalCommits = ref(0)
const currentYearCommits = ref(0)
const meta = reactive({ total: 0 })
const repoActiveLoading = reactive<Record<number, boolean>>({})
const paging = reactive({ page: 1, pageSize: 40 })
const loading = ref(false)
const hasMore = ref(true)
const pendingReset = ref(false)
type SortKey
  = | 'totalCommits'
    | 'currentYearCommits'
    | 'repoCreatedAt'
    | 'latestCommitAt'
type SortDirection = 'asc' | 'desc' | null
const sortState = reactive<{ key: SortKey | null, direction: SortDirection }>({
  key: 'latestCommitAt',
  direction: 'desc'
})

function resetSort() {
  sortState.key = 'latestCommitAt'
  sortState.direction = 'desc'
}

const sortedRepos = computed(() => {
  let data = [...repos.value]

  // Frontend Filter: Repo Source
  if (filters.repoSourceId && filters.repoSourceId > 0) {
    data = data.filter(r => r.sourceId === filters.repoSourceId)
  }

  if (!sortState.key || !sortState.direction) {
    resetSort()
    return data
  }

  const direction = sortState.direction
  const key = sortState.key
  data.sort((a, b) => {
    const valueA = getSortValue(a, key)
    const valueB = getSortValue(b, key)
    if (valueA === valueB) {
      return 0
    }
    return direction === 'asc' ? valueA - valueB : valueB - valueA
  })
  return data
})

function getSortValue(repo: RepoSummary, key: SortKey): number {
  const parseDateValue = (value?: string | null) => {
    if (!value) {
      return 0
    }
    const timestamp = Date.parse(value)
    return Number.isNaN(timestamp) ? 0 : timestamp
  }
  if (key === 'latestCommitAt') {
    return parseDateValue(repo.latestCommitAt)
  }
  if (key === 'repoCreatedAt') {
    return parseDateValue(repo.repoCreatedAt)
  }
  if (key === 'totalCommits') {
    return Number(repo.totalCommits ?? 0)
  }
  return Number(repo.currentYearCommits ?? 0)
}

function toggleSort(key: SortKey) {
  if (sortState.key !== key) {
    sortState.key = key
    sortState.direction = 'desc'
    return
  }
  if (sortState.direction === 'desc') {
    sortState.direction = 'asc'
  } else if (sortState.direction === 'asc') {
    sortState.direction = null
    sortState.key = null
  } else {
    sortState.direction = 'desc'
  }
}

function sortIcon(key: SortKey) {
  if (sortState.key !== key || !sortState.direction) {
    return 'i-lucide-arrow-up-down'
  }
  return sortState.direction === 'asc'
    ? 'i-lucide-arrow-up'
    : 'i-lucide-arrow-down'
}

function sortHeaderClass(key: SortKey) {
  return sortState.key === key && sortState.direction
    ? 'text-primary-600'
    : 'text-muted-500'
}

// 预处理仓库对象的时间字段（latestCommitAt / lastScannedAt）去掉小数秒，避免界面多次做相同正则
const sanitizeTimestamp = (val: string | null | undefined) => {
  if (!val) return val as null | undefined
  return stripSubseconds(val)
}

const filteredTotalCommits = computed(() => {
  return sortedRepos.value.reduce((sum, r) => sum + (r.totalCommits ?? 0), 0)
})

async function loadRepos(options: { reset?: boolean } = {}) {
  if (loading.value) return
  if (options.reset) {
    repos.value = []
  }
  loading.value = true
  try {
    const params: Record<string, string | number | undefined> = {
      page: 1,
      pageSize: 10000
    }
    // Remove repoSourceId from API params to allow frontend filtering
    // if (filters.repoSourceId && filters.repoSourceId > 0) {
    //   params.repoSourceId = filters.repoSourceId
    // }
    if (filters.search) {
      params.search = filters.search
    }
    if (filters.validOnly) {
      params.isValid = 1
    }
    if (filters.deptId && filters.deptId > 0) {
      params.deptId = filters.deptId
    }
    const result = await $fetch<ReposResponse>(`${apiBase}/repos`, { params })
    const raw = result.data ?? []
    // 显式拷贝并清洗时间字段，防止直接修改响应引用（潜在的冻结对象或复用）
    repos.value = raw.map((r: RepoSummary) => ({
      ...r,
      repoCreatedAt: sanitizeTimestamp(r.repoCreatedAt),
      latestCommitAt: sanitizeTimestamp(r.latestCommitAt),
      lastScannedAt: sanitizeTimestamp(r.lastScannedAt)
    }))
    meta.total = result.meta?.total ?? repos.value.length
    // 计算累计提交与年度提交总和
    totalCommits.value = repos.value.reduce(
      (sum, r) => sum + (r.totalCommits ?? 0),
      0
    )
    currentYearCommits.value = repos.value.reduce(
      (sum, r) => sum + (r.currentYearCommits ?? 0),
      0
    )
    hasMore.value = false
    paging.page = 1
  } catch (error) {
    toast.add({
      title: '加载仓库列表失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    loading.value = false
    pendingReset.value = false
  }
}

await loadRepos({ reset: true })

async function triggerCatalogScan() {
  if (catalogScanLoading.value) {
    return
  }
  catalogScanLoading.value = true
  repoScanStatus.value = 'running'

  // Clear previous scan state
  clearGitlabRunState()
  clearSvnRunState()

  try {
    // Use unified scan endpoint - if a specific source is selected, pass its ID
    // Otherwise scan all active sources from repo_sources table
    const scanBody: { source_id?: number } = {}
    if (filters.repoSourceId !== 0) {
      scanBody.source_id = filters.repoSourceId
    }
    const result = await $fetch<ScanResult>(`${apiBase}/ingestion/repos/scan`, {
      method: 'POST',
      body: scanBody
    })

    // Display results in the unified log component
    gitlabScanResult.value = {
      processed: result.total_processed ?? result.processed ?? 0,
      succeeded: result.total_succeeded ?? result.succeeded ?? 0,
      failed: result.total_failed ?? result.failed ?? 0,
      runId: result.runId
    }

    if (result?.runId) {
      gitlabScanRunIds.value.push(result.runId)
      gitlabRunStatuses[result.runId] = 'running'
      await fetchGitlabScanLogs()
      await checkGitlabScanRunStatuses()
      if (!gitlabScanInterval.value) {
        gitlabScanInterval.value = setInterval(async () => {
          if (!isMounted.value) {
            stopGitlabScanPolling()
            return
          }
          await fetchGitlabScanLogs()
          await checkGitlabScanRunStatuses()
        }, 5000)
      }
    } else {
      repoScanStatus.value = 'success'
      // Refresh repo sources to update lastSyncedAt display
      await refreshRepoSources()
      toast.add({
        title: '仓库扫描完成',
        description: `处理 ${result.total_processed ?? result.processed ?? 0} 个源，成功 ${result.total_succeeded ?? result.succeeded ?? 0} 个`,
        color: 'success'
      })
    }
  } catch (error) {
    repoScanStatus.value = 'failed'
    toast.add({
      title: '仓库扫描触发失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    catalogScanLoading.value = false
  }
}

watch(
  () => [filters.deptId, filters.validOnly],
  () => {
    loadRepos({ reset: true })
  }
)

watchDebounced(
  () => filters.search,
  () => {
    loadRepos({ reset: true })
  },
  { debounce: 300, maxWait: 1000 }
)

const refreshRepos = async () => {
  await loadRepos({ reset: true })
}

const isInitialLoading = computed(
  () => loading.value && repos.value.length === 0
)

const columns = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'departmentId', header: '部门' },
  { accessorKey: 'sourceType', header: '来源' },
  { accessorKey: 'totalCommits', header: '版本数' },
  { accessorKey: 'latestCommitAt', header: '最新提交时间' },
  { accessorKey: 'repoCreatedAt', header: '创建时间' },
  { accessorKey: 'isValid', header: '有效' }
]

// Fetch repo sources for the dropdown filter
interface RepoSource {
  id: number
  sourceName: string
  sourceType: string
  isActive: boolean
  lastSyncedAt: string | null
  reposBase: string | null
}

const { data: repoSourcesResponse, refresh: refreshRepoSources } = useAsyncData(
  'repoSources',
  () => $fetch<{ data: RepoSource[] }>(`${apiBase}/settings/repo-sources`, { query: { is_active: '1' } }),
  { server: false }
)

const repoSourceTabs = computed(() => [
  { label: '全部仓库源', value: '0', slot: 'all' },
  ...(repoSourcesResponse.value?.data ?? [])
    .filter(source => source.isActive)
    .map(source => ({
      label: `${source.sourceName}`,
      value: String(source.id),
      slot: `source-${source.id}`,
      badge: source.reposBase ? source.reposBase : '-'
    }))
])

const selectedRepoSource = ref<RepoSource | undefined>(undefined)
watch(() => filters.repoSourceId, () => {
  selectedRepoSource.value = repoSourcesResponse.value?.data?.find(s => s.id === filters.repoSourceId)
})

// Get the selected source name for display in scan modal

const scanModalTitle = computed(() =>
  selectedRepoSource.value?.sourceName ? `扫描仓库 - ${selectedRepoSource.value.sourceName}` : '扫描仓库'
)

const { data: departmentsResponse, error: departmentsError } = useAsyncData(
  'repoDepartments',
  () => $fetch<{ data: Department[] }>(`${apiBase}/departments`),
  { server: false }
)

// Handle departments loading error
watch(
  departmentsError,
  (error) => {
    if (error && import.meta.client) {
      toast.add({
        title: '加载部门列表失败',
        description: extractErrorMessage(error),
        color: 'error'
      })
    }
  },
  { immediate: true }
)
const departments = computed(() => departmentsResponse.value?.data ?? [])
const validDepartments = computed(() =>
  departments.value.filter(dept => dept.isActive)
)
const departmentNameMap = computed(() => {
  const map: Record<number, string> = {}
  validDepartments.value.forEach((dept) => {
    map[dept.id] = dept.name
  })
  return map
})

const deptFilterOptions = computed(() => [
  { label: '全部', value: 0 },
  ...validDepartments.value.map(dept => ({
    label: dept.name,
    value: dept.id
  }))
])

const editableDeptOptions = computed(() =>
  validDepartments.value.map(dept => ({
    label: dept.name,
    value: dept.id
  }))
)

const getDepartmentLabel = (id: number | null | undefined) => {
  if (id == null) {
    return '未分配'
  }
  return departmentNameMap.value[id] ?? '未知'
}

// =============== 采集（扫描）操作：移入仓库列表页 ===============
interface GitlabFormState {
  gitlabUrl?: string
  groupId?: string
}

interface SvnFormState {
  svnRoot?: string
}

interface RepoScanStatus {
  repo_key: string
  status: string
  change: string
  repo_catalog_id?: number | null
  failure_reason?: string | null
}

interface ScanResult {
  processed: number
  succeeded: number
  failed: number
  total_processed?: number
  total_succeeded?: number
  total_failed?: number
  runId?: number
  updatedRepoIds?: number[]
  repositories?: RepoScanStatus[]
  sources?: unknown[]
}

const config = useRuntimeConfig()
type IngestionDefaults = { gitlabBaseUrl: string, hasGitlabToken: boolean }
const ingestionDefaults = computed<IngestionDefaults>(() => {
  const pub = config.public as { ingestionDefaults?: IngestionDefaults }
  return pub.ingestionDefaults || { gitlabBaseUrl: '', hasGitlabToken: false }
})

const gitlabScanLoading = ref(false)
const gitlabScanState = reactive<GitlabFormState>({
  gitlabUrl: '',
  groupId: ''
})

const gitlabScanRunIds = ref<number[]>([])
const gitlabRunStatuses = reactive<Record<number, ScanStatus>>({})
const gitlabScanResult = ref<ScanResult | null>(null)
const repoScanStatus = ref<ScanStatus>('idle')
const gitlabScanLogs = ref<IngestionRunLog[]>([])
const gitlabScanLogsLoading = ref(false)
const gitlabScanInterval = ref<ReturnType<typeof setInterval> | null>(null)

const gitlabScanUpdatedCount = computed(
  () => gitlabScanResult.value?.updatedRepoIds?.length ?? 0
)

const svnScanRunIds = ref<number[]>([])
const svnRunStatuses = reactive<Record<number, ScanStatus>>({})
const svnScanResult = ref<ScanResult | null>(null)
const svnScanLogs = ref<IngestionRunLog[]>([])
const svnScanInterval = ref<ReturnType<typeof setInterval> | null>(null)

// Compute overall run status for each source type
const gitlabScanRunStatus = computed<ScanStatus>(() => {
  if (gitlabScanRunIds.value.length === 0) return 'idle'
  const statuses = Object.values(gitlabRunStatuses)
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('running')) return 'running'
  return 'success'
})

// ============= 共享的扫描/聚合对话框状态 ===============

const catalogScanOpen = ref(false)
const catalogScanLoading = ref(false)
const catalogScanLogRef = ref<HTMLDivElement | null>(null)
const combinedScanLogs = computed(() => {
  const logs = [
    ...gitlabScanLogs.value.map(log => ({
      ...log,
      source: 'gitlab' as const
    })),
    ...svnScanLogs.value.map(log => ({ ...log, source: 'svn' as const }))
  ]
  return logs.sort((a, b) => {
    const timeA = Date.parse(a.createdAt)
    const timeB = Date.parse(b.createdAt)
    return timeA - timeB
  })
})

const svnScanLoading = ref(false)
const svnScanState = reactive<SvnFormState>({
  svnRoot: ''
})

function resetGitlabForm(state: GitlabFormState) {
  state.gitlabUrl = ''
  state.groupId = ''
}

function resetSvnForm(state: SvnFormState) {
  state.svnRoot = ''
}

function clearGitlabRunState() {
  stopGitlabScanPolling()
  gitlabScanRunIds.value = []
  gitlabScanLogs.value = []
  gitlabScanResult.value = null
  Object.keys(gitlabRunStatuses).forEach((key) => {
    Reflect.deleteProperty(gitlabRunStatuses, key)
  })
  repoScanStatus.value = 'idle'
}

function clearSvnRunState() {
  stopSvnScanPolling()
  svnScanRunIds.value = []
  svnScanLogs.value = []
  svnScanResult.value = null
  Object.keys(svnRunStatuses).forEach((key) => {
    Reflect.deleteProperty(svnRunStatuses, key)
  })
  repoScanStatus.value = 'idle'
}

watch(catalogScanOpen, (open) => {
  if (open) {
    gitlabScanState.gitlabUrl = ingestionDefaults.value.gitlabBaseUrl || ''
    svnScanState.svnRoot = ''
  } else {
    // Delay reset to avoid "parentNode" error during modal transition/unmount
    setTimeout(() => {
      if (!isMounted.value) return // Guard against unmounted component
      resetGitlabForm(gitlabScanState)
      gitlabScanLoading.value = false
      clearGitlabRunState()
      resetSvnForm(svnScanState)
      svnScanLoading.value = false
      clearSvnRunState()
    }, 300)
  }
})

watch(
  () => combinedScanLogs.value.length,
  async () => {
    if (!isMounted.value) return // Guard against unmounted component
    await nextTick()
    if (catalogScanLogRef.value) {
      catalogScanLogRef.value.scrollTop = catalogScanLogRef.value.scrollHeight
    }
  }
)

watch(repoScanStatus, (st) => {
  if (st !== 'running') {
    gitlabScanLoading.value = false
  }
})

watch(repoScanStatus, (st) => {
  if (st !== 'running') {
    svnScanLoading.value = false
  }
})

async function toggleRepoActive(repo: RepoSummary, value: boolean) {
  if (repoActiveLoading[repo.id]) {
    return
  }
  const previous = repo.isValid
  repo.isValid = value
  repoActiveLoading[repo.id] = true
  try {
    await $fetch(`${apiBase}/repos/${repo.id}/active`, {
      method: 'PATCH',
      body: { is_valid: value ? 1 : 0 }
    })
    toast.add({
      title: value ? '已标记为有效仓库' : '已标记为无效仓库',
      description: `${repo.name} 已更新有效状态`,
      color: 'success'
    })
    // Local state already updated optimistically above, no need to refresh
  } catch (error) {
    repo.isValid = previous
    toast.add({
      title: '更新有效状态失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    repoActiveLoading[repo.id] = false
  }
}

const departmentUpdating = reactive<Record<number, boolean>>({})

async function updateRepoDepartment(
  repo: RepoSummary,
  value: number | string | null | undefined
) {
  if (departmentUpdating[repo.id]) {
    return
  }
  const deptId = value == null ? null : Number(value)
  if (
    deptId === repo.departmentId
    || (deptId !== null && Number.isNaN(deptId))
  ) {
    return
  }
  const previous = repo.departmentId
  repo.departmentId = deptId
  departmentUpdating[repo.id] = true
  try {
    await $fetch(`${apiBase}/repos/${repo.id}/department`, {
      method: 'PATCH',
      body: { departmentId: deptId }
    })
  } catch (error) {
    repo.departmentId = previous
    toast.add({
      title: '更新部门失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    departmentUpdating[repo.id] = false
  }
}

async function fetchGitlabScanLogs() {
  if (gitlabScanRunIds.value.length === 0) {
    gitlabScanLogs.value = []
    return
  }
  const existing = new Map<number, IngestionRunLog>()
  gitlabScanLogs.value.forEach(log => existing.set(log.id, log))
  for (const runId of gitlabScanRunIds.value) {
    const response = await $fetch<{ data: IngestionRunLog[] }>(
      `${apiBase}/ingestion/runs/${runId}/logs`,
      { query: { limit: 500 } }
    )
    for (const log of response.data ?? []) existing.set(log.id, log)
  }
  gitlabScanLogs.value = Array.from(existing.values()).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  )
}

async function fetchSvnScanLogs() {
  if (svnScanRunIds.value.length === 0) {
    svnScanLogs.value = []
    return
  }
  const existing = new Map<number, IngestionRunLog>()
  svnScanLogs.value.forEach(log => existing.set(log.id, log))
  for (const runId of svnScanRunIds.value) {
    const response = await $fetch<{ data: IngestionRunLog[] }>(
      `${apiBase}/ingestion/runs/${runId}/logs`,
      { query: { limit: 500 } }
    )
    for (const log of response.data ?? []) existing.set(log.id, log)
  }
  svnScanLogs.value = Array.from(existing.values()).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  )
}

async function checkGitlabScanRunStatuses() {
  if (gitlabScanRunIds.value.length === 0) return
  if (!isMounted.value) return
  let anyRunning = false
  let anyFailed = false
  for (const runId of gitlabScanRunIds.value) {
    if (!isMounted.value) return
    const run = await $fetch<IngestionRun>(`${apiBase}/ingestion/runs/${runId}`)
    let status: ScanStatus
    if (run.status === 'success') status = 'success'
    else if (run.status === 'failed') status = 'failed'
    else status = 'running'
    gitlabRunStatuses[runId] = status
    if (status === 'running') anyRunning = true
    else if (status === 'failed') anyFailed = true
  }
  if (!isMounted.value) return
  if (anyFailed) repoScanStatus.value = 'failed'
  else if (anyRunning) repoScanStatus.value = 'running'
  else repoScanStatus.value = 'success'
  if (!anyRunning) {
    stopGitlabScanPolling()
    // Refresh repo sources to update lastSyncedAt display (only if still mounted)
    if (isMounted.value) {
      await refreshRepoSources()
    }
  }
}

const integerFormatter = new Intl.NumberFormat('en-US')
const formatCommitCount = (value?: number | null) => {
  if (value === null || value === undefined) {
    return '-'
  }
  return integerFormatter.format(value)
}

function stopGitlabScanPolling() {
  if (gitlabScanInterval.value) {
    clearInterval(gitlabScanInterval.value)
    gitlabScanInterval.value = null
  }
}

function stopSvnScanPolling() {
  if (svnScanInterval.value) {
    clearInterval(svnScanInterval.value)
    svnScanInterval.value = null
  }
}

// Parse date string from DB (assumed to be in server timezone UTC+8)
const parseServerTime = (dateStr: string): Date => {
  // DB returns time without timezone, assume it's UTC+8 (server timezone)
  const cleanedStr = dateStr.replace(' ', 'T')
  const withTimezone = cleanedStr.includes('+') || cleanedStr.includes('Z')
    ? cleanedStr
    : `${cleanedStr}+08:00`
  return new Date(withTimezone)
}

// Format relative time (e.g., '5分钟前', '2小时前', '3天前')
const formatRelativeTime = (date: Date) => {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 30) return `${diffDays}天前`
  return formatDate(date.toISOString())
}

// Compute the last synced time from repo_sources
// When "全部" is selected (repoSourceId = 0), show the earliest sync time
// When a specific source is selected, show that source's sync time
const latestScannedAt = computed(() => {
  const sources = repoSourcesResponse.value?.data ?? []
  if (sources.length === 0) return null

  if (filters.repoSourceId === 0) {
    // Find the earliest lastSyncedAt among all sources
    let earliest: Date | null = null
    for (const source of sources) {
      if (source.lastSyncedAt) {
        const d = parseServerTime(source.lastSyncedAt)
        if (!isNaN(d.getTime()) && (!earliest || d < earliest)) {
          earliest = d
        }
      }
    }
    return earliest ? formatRelativeTime(earliest) : null
  } else {
    // Find the specific source's lastSyncedAt
    const source = sources.find(s => s.id === filters.repoSourceId)
    if (source?.lastSyncedAt) {
      const d = parseServerTime(source.lastSyncedAt)
      return !isNaN(d.getTime()) ? formatRelativeTime(d) : null
    }
    return null
  }
})

// Cleanup on component unmount to prevent errors when navigating away
onBeforeUnmount(() => {
  isMounted.value = false
  stopGitlabScanPolling()
  stopSvnScanPolling()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel
      id="repo-list"
      class="*:data-[slot=header]:overflow-visible!"
      :ui="{ body: 'gap-1 sm:p-3' }"
    >
      <template #header>
        <UDashboardNavbar
          title="仓库列表"
          :ui="{ root: 'h-12' }"
        >
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>
          <template #right>
            <UButton
              icon="i-lucide-info"
              variant="ghost"
              color="neutral"
              size="sm"
              class="pr-0"
            />
            <span class="text-xs text-muted-500">提示：仓库无需手工添加，通过扫描功能可自动识别并创建</span>
          </template>
        </UDashboardNavbar>

        <!-- Repo Source Tabs -->
        <UTabs
          :items="repoSourceTabs"
          :model-value="String(filters.repoSourceId)"
          variant="link"
          :ui="{ trigger: 'grow', root: 'pb-0' }"
          class="gap-4 w-full"
          @update:model-value="(val: string | number) => filters.repoSourceId = Number(val)"
        />

        <UDashboardToolbar :ui="{ root: 'relative z-50 !overflow-visible' }">
          <template #left>
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">部门:</span>
              <USelect
                v-model="filters.deptId"
                :items="deptFilterOptions"
                value-key="value"
                label-key="label"
                size="sm"
                class="min-w-[120px]"
              />
            </div>
            <div class="flex items-center gap-2 pl-4">
              <USwitch
                v-model="filters.validOnly"
                unchecked-icon="i-lucide-x"
                checked-icon="i-lucide-check"
                size="sm"
                label="仅有效"
              />
            </div>
          </template>
          <template #right>
            <div class="px-4 py-2 text-center text-xs text-muted-500">
              {{ sortedRepos.length }} 个仓库，总计 {{ filteredTotalCommits || 0 }} 个版本
            </div>
            <span
              v-if="latestScannedAt"
              class="text-xs text-muted-500 mr-2"
            >
              上次扫描：{{ latestScannedAt }}
            </span>
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-radar"
              size="sm"
              @click="
                () => {
                  catalogScanOpen = true;
                }
              "
            >
              扫描仓库
            </UButton>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <UCard :ui="{ body: 'p-0' }">
          <div>
            <UTable
              :data="sortedRepos"
              :columns="columns"
              :ui="{ td: 'p-2', th: 'text-center' }"
              :loading="isInitialLoading"
              empty-state-title="暂无数据"
              sticky
              class="h-[calc(100vh-210px)] overflow-auto pt-0"
            >
              <template #id-header="">
                <div class="flex justify-start">
                  <span>ID</span>
                </div>
              </template>
              <template #id-cell="{ row }">
                <span>{{ row.original.id }}</span>
              </template>
              <template #name-header="">
                <span>仓库名称</span>
              </template>
              <template #name-cell="{ row }">
                <UButton
                  :to="`/repos/${row.original.id}`"
                  variant="ghost"
                  color="secondary"
                  class="font-medium hover:underline"
                >
                  {{ row.original.name }}
                </UButton>
                <p class="text-xs text-muted-500">
                  {{ row.original.description }}
                </p>
              </template>
              <template #departmentId-header>
                <button
                  type="button"
                  class="flex items-center gap-1 font-semibold"
                >
                  <span>部门</span>
                </button>
              </template>
              <template #departmentId-cell="{ row }">
                <div class="max-w-[140px]">
                  <ClientOnly>
                    <template #default>
                      <USelect
                        :model-value="row.original.departmentId ?? undefined"
                        :items="editableDeptOptions"
                        placeholder="请选择"
                        variant="ghost"
                        value-key="value"
                        label-key="label"
                        :ui="{
                          value: 'capitalize',
                          itemLabel: 'capitalize',
                          trailingIcon:
                            'group-data-[state=open]:rotate-180 transition-transform duration-200'
                        }"
                        :disabled="departmentUpdating[row.original.id]"
                        @update:model-value="(value: number | string | null | undefined) => updateRepoDepartment(row.original, value)"
                      />
                    </template>
                    <template #fallback>
                      <span class="text-sm text-muted-500">
                        {{ getDepartmentLabel(row.original.departmentId) }}
                      </span>
                    </template>
                  </ClientOnly>
                </div>
              </template>
              <template #sourceType-cell="{ row }">
                <div class="flex justify-center gap-2">
                  <UBadge
                    :label="row.original.sourceType?.toUpperCase() || '-'"
                    :color="row.original.sourceType === 'svn' ? 'primary' : 'success'
                    "
                    variant="subtle"
                  />
                </div>
              </template>
              <template #latestRevision-cell="{ row }">
                <span class="font-mono text-muted-700">
                  {{ row.original.latestRevision || "-" }}
                </span>
              </template>
              <template #totalCommits-header>
                <div class="flex justify-end gap-1 font-semibold">
                  <button
                    type="button"
                    class="flex gap-1 font-semibold"
                    :class="sortHeaderClass('totalCommits')"
                    @click="toggleSort('totalCommits')"
                  >
                    <span>版本数</span>
                    <UIcon
                      :name="sortIcon('totalCommits')"
                      class="h-3.5 w-3.5"
                    />
                  </button>
                </div>
              </template>
              <template #totalCommits-cell="{ row }">
                <div class="font-mono text-sm text-muted-700 text-right">
                  {{ formatCommitCount(row.original.totalCommits) }}
                </div>
              </template>
              <template #repoCreatedAt-header>
                <div class="flex justify-center">
                  <button
                    type="button"
                    class="flex items-center gap-1 font-semibold"
                    :class="sortHeaderClass('repoCreatedAt')"
                    @click="toggleSort('repoCreatedAt')"
                  >
                    <span>创建时间</span>
                    <UIcon
                      :name="sortIcon('repoCreatedAt')"
                      class="h-3.5 w-3.5"
                    />
                  </button>
                </div>
              </template>
              <template #repoCreatedAt-cell="{ row }">
                <div class="flex justify-center">
                  <span
                    v-if="row.original.repoCreatedAt"
                    class="font-mono"
                  >{{
                    formatDate(row.original.repoCreatedAt)
                  }}</span>
                  <span
                    v-else
                    class="text-muted-400"
                  >-</span>
                </div>
              </template>
              <template #scanStatus-cell="{ row }">
                <UBadge
                  :label="row.original.scanStatus"
                  :color="row.original.scanStatus === 'success'
                    ? 'success'
                    : row.original.scanStatus === 'failed'
                      ? 'error'
                      : 'neutral'
                  "
                  variant="soft"
                />
              </template>
              <template #latestCommitAt-header>
                <div class="flex justify-center">
                  <button
                    type="button"
                    class="flex items-center gap-1 font-semibold"
                    :class="sortHeaderClass('latestCommitAt')"
                    @click="toggleSort('latestCommitAt')"
                  >
                    <span>最新提交时间</span>
                    <UIcon
                      :name="sortIcon('latestCommitAt')"
                      class="h-3.5 w-3.5"
                    />
                  </button>
                </div>
              </template>
              <template #latestCommitAt-cell="{ row }">
                <div class="flex justify-center">
                  <span
                    v-if="row.original.latestCommitAt"
                    class="font-mono"
                  >{{
                    formatDate(row.original.latestCommitAt)
                  }}</span>
                  <span
                    v-else
                    class="text-muted-400"
                  >-</span>
                </div>
              </template>
              <template #lastScannedAt-cell="{ row }">
                <div class="flex justify-center">
                  <span
                    v-if="row.original.lastScannedAt"
                    class="font-mono"
                  >{{
                    formatDate(row.original.lastScannedAt)
                  }}</span>
                  <span
                    v-else
                    class="text-muted-400"
                  >-</span>
                </div>
              </template>
              <template #isValid-cell="{ row }">
                <USwitch
                  v-model="row.original.isValid"
                  :loading="Boolean(repoActiveLoading[row.original.id])"
                  @update:model-value="(value: boolean) => toggleRepoActive(row.original, value)"
                />
              </template>
            </UTable>
            <div
              v-if="!isInitialLoading && repos.length === 0"
              class="py-10 text-center text-sm text-muted-500"
            >
              暂无仓库
            </div>
          </div>
        </UCard>
      </template>
    </UDashboardPanel>

    <!-- 仓库扫描对话框 -->
    <UModal
      v-model:open="catalogScanOpen"
      :ui="{ content: 'sm:max-w-3xl' }"
      title="触发全量扫描"
    >
      <template #body>
        <div
          class="space-y-6"
          aria-describedby="scan-modal-description"
        >
          <div
            id="scan-modal-description"
            class="hidden"
          >
            扫描所有代码仓库，提取提交记录和代码统计信息
          </div>
          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <span>{{ selectedRepoSource?.sourceName ? `将扫描数据源「${selectedRepoSource.sourceName}」中的仓库。`
                : '将扫描所有活跃数据源中的仓库。' }}凭据由服务端管理,无需手动输入。</span>
            </div>
            <div class="space-y-4 pt-2">
              <ScanLogsAndStats
                v-if="gitlabScanRunIds.length > 0 || gitlabScanLogs.length > 0"
                title="仓库扫描"
                :logs="gitlabScanLogs"
                :logs-loading="gitlabScanLogsLoading"
                :result="gitlabScanResult"
                :updated-count="gitlabScanUpdatedCount"
                source-type="All"
                :run-status="gitlabScanRunStatus"
              />
            </div>
          </section>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="subtle"
              @click="catalogScanOpen = false"
            >
              关闭窗口
            </UButton>
            <UButton
              color="primary"
              icon="i-lucide-rotate-ccw"
              :loading="catalogScanLoading"
              :disabled="catalogScanLoading"
              :label="catalogScanLoading ? '正在扫描...' : '触发扫描'"
              @click="triggerCatalogScan"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
