<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
// import { watchDebounced } from '@vueuse/core'
import type { RepoSummary, Department, IngestionRunLog, IngestionRun } from '~/types/repoinsight'
import IngestionModal from '~/components/repoinsight/ingestion/IngestionModal.vue'
import RepoSyncModal from '~/components/repoinsight/ingestion/RepoSyncModal.vue'
import AggregateModal from '~/components/repoinsight/statistics/AggregateModal.vue'

// Use centralized API base resolver for custom domain compatibility
const { apiBase } = useApiBase()

const filters = reactive({
  sourceType: 'all',
  search: '',
  validOnly: true,
  deptId: 0
})
// const currentYear = computed(() => defaultCommitYear.value)

const toast = useToast()

const ingestionCompleted = ref(false)

// 日期格式化函数（仅到秒）支持含微秒的字符串，例如 2025-11-06 22:31:16.999355
// 不依赖 Date 解析，直接截取并归一化
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  // 兼容包含 T / 空格分隔，以及可能附带的微秒与时区
  const match = dateStr.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  )
  if (match) {
    return `${match[1]} ${match[2]}`
  }
  // 若不是上述格式，尝试用 Date 解析（可能是其它兼容形式）
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr // 保留原始字符串，方便排查异常格式
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const formatCommitCount = (count: number | undefined | null) => {
  return (count ?? 0).toLocaleString()
}

// 通用错误消息提取（与 ingestion 页面保持一致，避免重复代码）
function extractErrorMessage(error: unknown) {
  const err = error as {
    data?: {
      statusMessage?: string
      message?: string
      detail?: string
    }
    statusMessage?: string
    message?: string
  }
  return (
    err?.data?.statusMessage
    || err?.data?.message
    || err?.data?.detail
    || err?.statusMessage
    || err?.message
    || '未知错误'
  )
}

// 去除字符串中的“秒后小数部分”（微秒/毫秒），统一保留到秒
// 支持格式：
// - 2025-11-06 22:31:16.999355
// - 2025-11-06T22:31:16.123Z
// - 2025-11-06 22:31:16.5+08:00
const stripSubseconds = (text: string) =>
  text.replace(
    /(\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\.\d+)((?:Z|[+-]\d{2}:\d{2})?\b)/g,
    '$1$2'
  )

// 规范化日志展示用文本：输入任意值，输出去除小数秒后的字符串（扫描日志已移除，保留工具函数备用）

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
const totalIngestedCommits = ref(0)
const totalSyncedCommits = ref(0)
// const currentYearCommits = ref(0)
const meta = reactive({ total: 0 })
// const repoActiveLoading = reactive<Record<number, boolean>>({})
const paging = reactive({ page: 1, pageSize: 40 })
const loading = ref(false)
const hasMore = ref(true)
const pendingReset = ref(false)
type SortKey
  = | 'totalCommits'
    | 'syncedCommits'
    | 'ingestedCommits'
    | 'repoCreatedAt'
    | 'latestCommitAt'
type SortDirection = 'asc' | 'desc' | null
const sortState = reactive<{ key: SortKey | null, direction: SortDirection }>({
  key: null,
  direction: null
})

// 预处理仓库对象的时间字段（latestCommitAt / lastScannedAt）去掉小数秒，避免界面多次做相同正则
const sanitizeTimestamp = (val: string | null | undefined) => {
  if (!val) return val as null | undefined
  return stripSubseconds(val)
}

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
    if (filters.sourceType !== 'all') {
      params.sourceType = filters.sourceType
    }
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
    totalIngestedCommits.value = repos.value.reduce(
      (sum, r) => sum + (r.ingestedCommits ?? 0),
      0
    )
    totalSyncedCommits.value = repos.value.reduce(
      (sum, r) => sum + (r.syncedCommits ?? 0),
      0
    )
    // currentYearCommits.value = repos.value.reduce((sum, r) => sum + (r.currentYearCommits ?? 0), 0)
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

// 最近一次“Progress”日志统计（processed_total/total_commits）
const ingestProgressText = ref<string>('入库进度：-')
const ingestProgressLoading = ref(false)

// async function loadIngestProgressLatest() {
//   try {
//     ingestProgressLoading.value = true
//     const resp = await $fetch<{
//       data: {
//         percent: number
//         processedTotal: number
//         totalCommits: number
//       } | null
//     }>('/api/ingestion/runs/progress-latest')
//     const d = resp?.data
//     if (!d || !Number.isFinite(d.totalCommits)) {
//       ingestProgressText.value = '入库进度：-'
//       return
//     }
//     // const percent = Number.isFinite(d.percent)
//     //   ? d.percent
//     //   : (d.totalCommits > 0 ? Number(((d.processedTotal * 100) / d.totalCommits).toFixed(1)) : 0)
//     // 仅显示 context.json 中的 processed_total 值
//     ingestProgressText.value = `入库进度：${d.processedTotal}`
//   } catch {
//     // 静默失败，仅保留占位
//     ingestProgressText.value = '入库进度：-'
//   } finally {
//     ingestProgressLoading.value = false
//   }
// }

const sortedRepos = computed(() => {
  if (!sortState.key || !sortState.direction) {
    return [...repos.value]
  }
  const data = [...repos.value]
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
  return Number(repo.ingestedCommits ?? 0)
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

watch(
  () => [filters.sourceType, filters.deptId, filters.validOnly],
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

// 计算并回写有效仓库的已处理提交数（ingested_commits）
const checkingProgress = ref(false)
async function checkProgress() {
  try {
    checkingProgress.value = true
    const res = await $fetch<{
      updated: number
      validRepos: number
      totalIngestedCommits: number
    }>(`${apiBase}/ingestion/repos/stats`, { method: 'POST' })
    // toast.add({
    //   title: '进度已计算',
    //   description: `有效仓库 ${res.validRepos} 个，更新 ${res.updated} 行，累计已处理提交 ${res.totalIngestedCommits}`,
    //   color: 'primary'
    // })
    await refreshRepos()
  } catch (error) {
    toast.add({
      title: '进度计算失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    checkingProgress.value = false
  }
}

// =============== 文件入库运行日志（commit_files_ingest）查看 ===============
// interface IngestionRunItem {
//   id: number
// }
// interface IngestionRunsResponse {
//   data: Array<{ id: number }>
// }
// interface IngestionLogItem {
//   id: number
//   runId: number
//   level: string
//   message: string
//   context?: unknown
//   createdAt: string
// }
// interface IngestionLogsResponse {
//   data: IngestionLogItem[]
// }

const logsModalOpen = ref(false)

function openIngestLogsModal() {
  logsModalOpen.value = true
}

function onIngestProgress(val: string) {
  ingestProgressText.value = `入库进度：${val}`
  checkProgress()
}

const isInitialLoading = computed(
  () => loading.value && repos.value.length === 0
)

const columns = [
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'departmentId', header: '部门' },
  { accessorKey: 'sourceType', header: '来源' },
  // { accessorKey: 'latestRevision', header: '最新版本' },
  { accessorKey: 'totalCommits', header: '累计提交' },
  { accessorKey: 'syncedCommits', header: '已同步' },
  { accessorKey: 'ingestedCommits', header: '已入库' },
  // { accessorKey: 'currentYearCommits', header: '年度提交' },
  { accessorKey: 'repoCreatedAt', header: '创建时间' },
  { accessorKey: 'latestCommitAt', header: '最新提交时间' }
]

const sourceTypeOptions = [
  { label: '全部', value: 'all' },
  { label: 'SVN', value: 'svn' },
  { label: 'GitLab', value: 'gitlab' }
]

const { data: departmentsResponse } = useAsyncData('repoDepartments', () =>
  $fetch<{ data: Department[] }>(`${apiBase}/departments`)
)

const departmentNameMap = computed(() => {
  const map: Record<number, string> = {}
  departmentsResponse.value?.data.forEach((dept) => {
    map[dept.id] = dept.name
  })
  return map
})

const getDepartmentLabel = (id: number | null | undefined) => {
  if (id == null) {
    return '未分配'
  }
  return departmentNameMap.value[id] ?? '未知'
}
const deptOptions = computed(() => {
  const options = [{ label: '全部', value: 0 }]
  if (departmentsResponse.value?.data) {
    for (const dept of departmentsResponse.value.data) {
      options.push({ label: dept.name, value: dept.id })
    }
  }
  return options
})

// Parse date string from DB (assumed to be in server timezone UTC+8)
const parseServerTime = (dateStr: string): Date => {
  // DB returns time without timezone, assume it's UTC+8 (server timezone)
  // Append +08:00 to make JavaScript parse it correctly
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

// Compute the latest scanned time across all repos (relative format)
const latestScannedAt = computed(() => {
  let latest: Date | null = null
  for (const repo of repos.value) {
    if (repo.lastScannedAt) {
      const d = parseServerTime(repo.lastScannedAt)
      if (!isNaN(d.getTime()) && (!latest || d > latest)) {
        latest = d
      }
    }
  }
  return latest ? formatRelativeTime(latest) : null
})

const repoSyncOpen = ref(false)
const reposToSync = ref<RepoSummary[]>([])

// const canSyncRepo = (repo: RepoSummary) =>
//   repo.sourceType === 'gitlab' || repo.sourceType === 'svn'

// function openRepoSyncModal(repo: RepoSummary) {
//   if (!canSyncRepo(repo)) {
//     toast.add({
//       title: '暂不支持该仓库',
//       description: '仅支持 GitLab / SVN 仓库同步。',
//       color: 'warning'
//     })
//     return
//   }
//   reposToSync.value = [repo]
//   repoSyncOpen.value = true
// }

function openBulkSyncModal() {
  const orderedRepos = repos.value.filter(
    repo => repo.sourceType === 'gitlab' || repo.sourceType === 'svn'
  )
  // Always allow opening the modal - it will load sync status from the database
  // This enables viewing progress of a running sync even after page refresh
  reposToSync.value = orderedRepos
  repoSyncOpen.value = true
}

watch(repoSyncOpen, (isOpen) => {
  if (!isOpen) {
    refreshRepos()
  }
})

// =============== 统计聚合操作 ===============
const statsAggregateLoading = ref(false)
const statsAggregateModalOpen = ref(false) // Modal state
const statsAggregateRunIds = ref<number[]>([])
const statsAggregateRunStatuses = reactive<Record<number, ScanStatus>>({})
const statsAggregateResult = ref<ScanResult | null>(null)
const statsAggregateLogs = ref<IngestionRunLog[]>([])
const statsAggregateInterval = ref<ReturnType<typeof setInterval> | null>(null)

interface ScanResult {
  processed?: number
  succeeded?: number
  failed?: number
  runId?: number
  status?: string
}

async function triggerAggregateStats(fullAggregation: boolean = false) {
  if (statsAggregateLoading.value) return
  ingestionCompleted.value = await $fetch<boolean>(`${apiBase}/system/ingestion_completed`)
  if (!ingestionCompleted.value) {
    toast.add({
      title: '数据入库未完成',
      description: '请先完成数据入库。',
      color: 'warning'
    })
    return
  }
  statsAggregateLoading.value = true
  try {
    const result = await $fetch<ScanResult>(`${apiBase}/statistics/aggregate`, {
      method: 'POST',
      body: { fullAggregation } // Pass fullAggregation flag
    })
    statsAggregateResult.value = result

    // Handle null runId by fetching the latest aggregate run
    let runId = result?.runId
    if (!runId && result?.status === 'started') {
      try {
        // Wait a moment for the run to be created
        await new Promise(resolve => setTimeout(resolve, 1000))

        const runsResponse = await $fetch<{ data: Array<{ id: number }> }>(
          `${apiBase}/ingestion/runs`,
          { params: { jobType: 'stats_aggregate', page: 1, pageSize: 1 } }
        )
        runId = runsResponse?.data?.[0]?.id
      } catch (error) {
        console.error('Failed to fetch latest runId:', error)
      }
    }

    if (runId) {
      statsAggregateRunIds.value.push(runId)
      statsAggregateRunStatuses[runId] = 'running'
      await fetchAggregateStatsLogs()
      await checkAggregateStatsRunStatuses()
      if (!statsAggregateInterval.value) {
        statsAggregateInterval.value = setInterval(async () => {
          await fetchAggregateStatsLogs()
          await checkAggregateStatsRunStatuses()
        }, 5000)
      }
    } else {
      statsAggregateLoading.value = false
      toast.add({
        title: '统计聚合任务已触发',
        description: '已成功触发统计聚合任务。',
        color: 'success'
      })
    }
  } catch (error) {
    statsAggregateLoading.value = false
    toast.add({
      title: '统计聚合触发失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  }
}

async function fetchAggregateStatsLogs() {
  if (statsAggregateRunIds.value.length === 0) {
    statsAggregateLogs.value = []
    return
  }
  const existing = new Map<number, IngestionRunLog>()
  statsAggregateLogs.value.forEach(log => existing.set(log.id, log))
  for (const runId of statsAggregateRunIds.value) {
    const response = await $fetch<{ data: IngestionRunLog[] }>(
      `${apiBase}/ingestion/runs/${runId}/logs`,
      { query: { limit: 500 } }
    )
    for (const log of response.data ?? []) existing.set(log.id, log)
  }
  statsAggregateLogs.value = Array.from(existing.values()).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  )
}

async function checkAggregateStatsRunStatuses() {
  if (statsAggregateRunIds.value.length === 0) return
  let anyRunning = false
  let anyFailed = false
  for (const runId of statsAggregateRunIds.value) {
    const run = await $fetch<IngestionRun>(`${apiBase}/ingestion/runs/${runId}`)
    let status: ScanStatus
    if (run.status === 'success') status = 'success'
    else if (run.status === 'failed') status = 'failed'
    else status = 'running'
    statsAggregateRunStatuses[runId] = status
    if (status === 'running') anyRunning = true
    else if (status === 'failed') anyFailed = true
  }
  if (!anyRunning) {
    stopAggregateStatsPolling()
    statsAggregateLoading.value = false
    if (anyFailed) {
      toast.add({
        title: '统计聚合任务失败',
        description: '部分聚合任务未能成功完成。',
        color: 'error'
      })
    } else {
      toast.add({
        title: '统计聚合任务完成',
        description: '所有聚合任务已成功完成。',
        color: 'success'
      })
    }
  }
}

async function checkActiveAggregateRun() {
  if (statsAggregateLoading.value) return
  try {
    const runsResponse = await $fetch<{ data: Array<{ id: number, status: string }> }>(
      `${apiBase}/ingestion/runs`,
      { params: { jobType: 'stats_aggregate', page: 1, pageSize: 1 } }
    )
    const latestRun = runsResponse?.data?.[0]
    if (latestRun && (latestRun.status === 'running' || latestRun.status === 'started')) {
      statsAggregateLoading.value = true
      // Check if we already tracking this run
      if (!statsAggregateRunIds.value.includes(latestRun.id)) {
        statsAggregateRunIds.value = [latestRun.id]
        statsAggregateRunStatuses[latestRun.id] = 'running'
        statsAggregateLogs.value = [] // Clear logs from previous session if any
      }

      // Resume polling
      await fetchAggregateStatsLogs()
      await checkAggregateStatsRunStatuses()
      if (!statsAggregateInterval.value) {
        statsAggregateInterval.value = setInterval(async () => {
          await fetchAggregateStatsLogs()
          await checkAggregateStatsRunStatuses()
        }, 5000)
      }
    }
  } catch (error) {
    console.error('Failed to check active aggregate run:', error)
  }
}

watch(statsAggregateModalOpen, (isOpen) => {
  if (isOpen) {
    checkActiveAggregateRun()
  } else {
    // Optional: stop polling when modal closes?
    // The user requirement implies we want to see it *when reopened*, so maybe we shouldn't stop it strictly,
    // but usually we stop polling to save resources.
    // If we stop polling here, the checkActiveAggregateRun will restart it next time.
    // However, if the task finishes while closed, next time we open we won't see it as "running".
    // But that's acceptable behavior (it's done).
    stopAggregateStatsPolling()
  }
})

function stopAggregateStatsPolling() {
  if (statsAggregateInterval.value) {
    clearInterval(statsAggregateInterval.value)
    statsAggregateInterval.value = null
  }
}

// Cleanup on component unmount to prevent errors when navigating away
onBeforeUnmount(() => {
  stopAggregateStatsPolling()
  statsAggregateLoading.value = false
  statsAggregateModalOpen.value = false
  logsModalOpen.value = false
  repoSyncOpen.value = false
})
</script>

<template>
  <!-- eslint-disable vue/html-indent -->
    <div class="flex flex-col flex-1 w-full min-w-0">
        <UDashboardPanel
id="repo-list"
class="*:data-[slot=header]:overflow-visible!"
:ui="{ body: 'gap-1 sm:p-3' }"
>
            <template #header>
                <UDashboardNavbar
title="数据入库"
:ui="{ root: 'h-12', right: 'gap-2' }"
>
                    <template #leading>
                        <UDashboardSidebarCollapse />
                    </template>
                    <template #right>
                        <span
v-if="latestScannedAt"
class="text-xs text-muted-500 mr-2"
>
                            上次扫描：{{ latestScannedAt }}
                        </span>
                        <UButton
color="primary"
variant="soft"
icon="i-lucide-list-tree"
size="sm"
                            @click="openBulkSyncModal"
>
                            版本记录同步
                        </UButton>
                        <UButton
color="primary"
variant="soft"
icon="i-lucide-list-video"
size="sm"
:loading="false"
                            @click="openIngestLogsModal"
>
                            版本数据入库
                        </UButton>
                        <UButton
color="primary"
variant="soft"
icon="i-lucide-combine"
size="sm"
                            :disabled="totalIngestedCommits !== totalCommits"
@click="statsAggregateModalOpen = true"
>
                            统计聚合
                        </UButton>
                        <UButton
color="secondary"
size="sm"
variant="soft"
icon="i-lucide-refresh-cw"
                            :loading="loading"
@click="() => checkProgress()"
>
                            刷新
                        </UButton>
                    </template>
                </UDashboardNavbar>

                <div
v-if="repos"
class="grid grid-cols-6 gap-3 px-3 pt-2 pb-0"
>
                    <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2', footer: 'p-0 sm:p-2' }">
                        <div class="flex items-center justify-center p-0">
                            <div class="text-xs pr-4 pt-2">
                                仓库数
                            </div>
                            <div class="text-2xl font-semibold text-secondary">
                                {{ repos.length }}
                            </div>
                        </div>
                    </UCard>
                    <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2', footer: 'p-0 sm:p-2' }">
                        <div class="flex items-center justify-center">
                            <div class="text-xs pr-4 pt-2">
                                版本数
                            </div>
                            <div class="text-2xl font-semibold text-primary">
                                {{ totalCommits }}
                            </div>
                        </div>
                    </UCard>
                    <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2', footer: 'p-0 sm:p-2' }">
                        <div class="flex items-center justify-center">
                            <div class="text-xs pr-4 pt-2">
                                已同步
                            </div>
                            <div class="text-2xl font-semibold text-primary">
                                {{ totalSyncedCommits }}
                            </div>
                        </div>
                    </UCard>
                    <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2', footer: 'p-0 sm:p-2' }">
                        <div class="flex items-center justify-center">
                            <div class="text-xs pr-4 pt-2">
                                已入库
                            </div>
                            <div class="text-2xl font-semibold text-primary">
                                {{ totalIngestedCommits }}
                            </div>
                        </div>
                    </UCard>
                    <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2', footer: 'p-0 sm:p-2' }">
                        <div class="flex items-center justify-center">
                            <div class="text-xs pr-4 pt-2">
                                进度：
                            </div>
                            <div class="text-2xl font-semibold text-success">
                                {{
                                    totalCommits > 0
                                        ? ((totalIngestedCommits / totalCommits) * 100).toFixed(1)
                                        + "%"
                                        : "0.0%"
                                }}
                            </div>
                        </div>
                    </UCard>
                    <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2', footer: 'p-0 sm:p-2' }">
                        <div class="flex items-center justify-center">
                            <div class="text-xs pr-4 pt-2">
                                上次扫描
                            </div>
                            <div class="text-2xl font-semibold text-muted-600">
                                {{ latestScannedAt ? latestScannedAt : "-" }}
                            </div>
                        </div>
                    </UCard>
                </div>
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
                            class="h-[calc(100vh-150px)] overflow-y-auto"
>
                            <template #name-cell="{ row }">
                                <div class="max-w-60 truncate">
                                    <NuxtLink
:to="`/repos/${row.original.id}`"
                                        class="font-medium text-sm hover:underline"
>
                                        {{ row.original.name }}
                                    </NuxtLink>
                                    <p class="text-xs text-muted-500">
                                        {{ row.original.description }}
                                    </p>
                                </div>
                            </template>
                            <template #departmentId-cell="{ row }">
                                <span class="text-sm text-muted-500">
                                    {{ getDepartmentLabel(row.original.departmentId) }}
                                </span>
                            </template>
                            <template #sourceType-cell="{ row }">
                                <div class="flex items-center justify-center gap-1">
                                    <UBadge
:label="row.original.sourceType.toUpperCase()"
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
                                <div class="flex justify-end gap-1">
                                    <button
type="button"
class="flex items-center gap-1 font-semibold"
                                        :class="sortHeaderClass('totalCommits')"
:loading="checkingProgress"
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
                            <template #ingestedCommits-header>
                                <div class="flex justify-end gap-1">
                                    <button
type="button"
class="flex items-center gap-1 font-semibold"
                                        :class="sortHeaderClass('ingestedCommits')"
                                        @click="toggleSort('ingestedCommits')"
>
                                        <span>已入库</span>
                                        <UIcon
:name="sortIcon('ingestedCommits')"
class="h-3.5 w-3.5"
/>
                                    </button>
                                </div>
                            </template>
                            <template #ingestedCommits-cell="{ row }">
                                <div class="font-mono text-sm text-muted-700 text-right">
                                    {{ formatCommitCount(row.original.ingestedCommits) }}
                                </div>
                            </template>
                            <template #syncedCommits-header>
                                <div class="flex justify-end gap-1">
                                    <button
type="button"
class="flex items-center gap-1 font-semibold"
                                        :class="sortHeaderClass('syncedCommits')"
@click="toggleSort('syncedCommits')"
>
                                        <span>已同步</span>
                                        <UIcon
:name="sortIcon('syncedCommits')"
class="h-3.5 w-3.5"
/>
                                    </button>
                                </div>
                            </template>
                            <template #syncedCommits-cell="{ row }">
                                <div class="font-mono text-sm text-muted-700 text-right">
                                    {{ formatCommitCount(row.original.syncedCommits) }}
                                </div>
                            </template>
                            <template #repoCreatedAt-header>
                                <div class="flex justify-center gap-1">
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
                                <div class="font-mono text-sm text-muted-700 text-center">
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
                            <template #latestCommitAt-header>
                                <div class="flex justify-center gap-1">
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
                                <div class="font-mono text-sm text-muted-700 text-center">
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

        <!-- 文件入库运行（commit_files_ingest）对话框 -->
        <IngestionModal
v-model:open="logsModalOpen"
@progress="onIngestProgress"
/>

        <!-- 仓库同步对话框 -->
        <RepoSyncModal
v-model:open="repoSyncOpen"
:repos="reposToSync"
@success="refreshRepos"
/>

        <!-- 统计聚合对话框 -->
        <AggregateModal
v-model:open="statsAggregateModalOpen"
:loading="statsAggregateLoading"
            :logs="statsAggregateLogs"
@start="triggerAggregateStats"
/>
    </div>

    <!-- 日志查看对话框中的 context 展示在每条日志下方 -->
</template>
