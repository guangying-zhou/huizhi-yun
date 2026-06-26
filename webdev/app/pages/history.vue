<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import JobEventStream from '~/components/webdev/JobEventStream.vue'

type BadgeColor = 'success' | 'error' | 'warning' | 'info' | 'neutral'

type Job = {
  id: string
  projectId?: string
  repoId?: string
  agentId?: string
  type: string
  status: string
  templateId?: string
  target?: string
  prompt?: string
  createdBy?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  error?: string
  eventCount?: number
}

type JobEvent = {
  jobId?: string
  sequence: number
  level: string
  message: string
  createdAt: string
}

type JobListResponse = {
  items: Job[]
  total: number
  page: number
  pageSize: number
}

const STATUS_ALL = '全部'

usePageTitle('历史记录')

const toast = useToast()
const { resolveCurrentAppPath } = useAppUrls()
const { setRefresh, clearRefresh } = usePageActions()

const keyword = ref('')
const statusFilter = ref(STATUS_ALL)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const eventsLoading = ref(false)
const items = ref<Job[]>([])
const total = ref(0)
const selectedJob = ref<Job | null>(null)
const selectedEvents = ref<JobEvent[]>([])

const statusOptions = [STATUS_ALL, 'queued', 'running', 'succeeded', 'failed', 'canceled']

const columns: TableColumn<Job>[] = [{
  accessorKey: 'status',
  header: '状态'
}, {
  accessorKey: 'prompt',
  header: '任务'
}, {
  accessorKey: 'repoId',
  header: '仓库'
}, {
  accessorKey: 'createdAt',
  header: '创建时间'
}, {
  accessorKey: 'eventCount',
  header: '事件'
}, {
  id: 'actions',
  header: ''
}]

const totalText = computed(() => {
  if (!total.value) return '0 条记录'
  const start = (page.value - 1) * pageSize + 1
  const end = Math.min(page.value * pageSize, total.value)
  return `${start}-${end} / ${total.value} 条记录`
})

function apiPath(path: string) {
  return resolveCurrentAppPath(path)
}

function fetchErrorDescription(error: unknown, fallback: string) {
  const err = error as {
    data?: {
      statusMessage?: string
      message?: string
    }
    message?: string
  }
  return err?.data?.statusMessage || err?.data?.message || err?.message || fallback
}

function statusColor(status: string | undefined): BadgeColor {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'canceled':
      return 'warning'
    case 'running':
      return 'info'
    default:
      return 'neutral'
  }
}

function formatClock(value: string | undefined) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatDuration(job: Job) {
  if (!job.startedAt || !job.finishedAt) return '-'
  const started = new Date(job.startedAt).getTime()
  const finished = new Date(job.finishedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-'
  const seconds = Math.round((finished - started) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

function reloadFirstPage() {
  if (page.value === 1) {
    loadJobs()
    return
  }
  page.value = 1
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = STATUS_ALL
  reloadFirstPage()
}

async function refreshPage() {
  await loadJobs()
  if (selectedJob.value) {
    await loadEvents(selectedJob.value)
  }
}

async function loadJobs() {
  loading.value = true
  try {
    const response = await $fetch<JobListResponse>(apiPath('/api/webdev/jobs'), {
      query: {
        page: page.value,
        pageSize,
        status: statusFilter.value === STATUS_ALL ? undefined : statusFilter.value,
        keyword: keyword.value.trim() || undefined
      }
    })
    items.value = response.items || []
    total.value = response.total || 0
  } catch (error: unknown) {
    toast.add({
      title: '历史记录加载失败',
      description: fetchErrorDescription(error, '无法读取 WebDev 历史记录'),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    loading.value = false
  }
}

async function loadEvents(job: Job) {
  eventsLoading.value = true
  try {
    const result = await $fetch<{ events: JobEvent[] }>(apiPath(`/api/webdev/jobs/${job.id}/events`), {
      query: {
        source: 'history'
      }
    })
    selectedEvents.value = result.events || []
  } catch (error: unknown) {
    selectedEvents.value = []
    toast.add({
      title: '任务日志加载失败',
      description: fetchErrorDescription(error, '无法读取该任务的历史日志'),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    eventsLoading.value = false
  }
}

async function selectJob(job: Job) {
  selectedJob.value = job
  selectedEvents.value = []
  await loadEvents(job)
}

onMounted(() => {
  setRefresh(refreshPage)
  loadJobs()
})

onBeforeUnmount(() => {
  clearRefresh()
})

watch(page, () => {
  loadJobs()
})

watch(statusFilter, () => {
  reloadFirstPage()
})
</script>

<template>
  <UDashboardPanel
    id="webdev-history"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-auto p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold">
              历史记录
            </h1>
            <p class="mt-1 text-sm text-muted">
              查看已持久化的 WebDev 任务、执行状态和日志事件。
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              to="/"
              icon="i-lucide-terminal"
              color="neutral"
              variant="ghost"
            >
              控制台
            </UButton>
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="soft"
              :loading="loading"
              @click="refreshPage"
            >
              刷新
            </UButton>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 rounded-md border border-default bg-elevated/30 p-3">
          <UInput
            v-model="keyword"
            class="min-w-60 flex-1"
            icon="i-lucide-search"
            placeholder="搜索任务 ID、指令、仓库或错误信息"
            @keydown.enter="reloadFirstPage"
          />
          <USelect
            v-model="statusFilter"
            class="w-36"
            :items="statusOptions"
          />
          <UButton
            icon="i-lucide-search"
            color="primary"
            variant="solid"
            @click="reloadFirstPage"
          >
            查询
          </UButton>
          <UButton
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            @click="resetFilters"
          >
            重置
          </UButton>
        </div>

        <div class="overflow-hidden rounded-md border border-default">
          <UTable
            :data="items"
            :columns="columns"
            :loading="loading"
          >
            <template #status-cell="{ row }">
              <UBadge
                :color="statusColor(row.original.status)"
                variant="soft"
              >
                {{ row.original.status || '-' }}
              </UBadge>
            </template>

            <template #prompt-cell="{ row }">
              <div class="max-w-md">
                <div class="truncate text-sm text-default">
                  {{ row.original.prompt || row.original.type || '-' }}
                </div>
                <div class="mt-1 truncate text-xs text-muted">
                  {{ row.original.id }}
                </div>
              </div>
            </template>

            <template #repoId-cell="{ row }">
              <div class="text-sm">
                {{ row.original.repoId || '-' }}
              </div>
              <div class="mt-1 text-xs text-muted">
                {{ row.original.templateId || '-' }}
              </div>
            </template>

            <template #createdAt-cell="{ row }">
              <div class="text-sm">
                {{ formatClock(row.original.createdAt) }}
              </div>
              <div class="mt-1 text-xs text-muted">
                耗时 {{ formatDuration(row.original) }}
              </div>
            </template>

            <template #eventCount-cell="{ row }">
              <span class="text-sm">{{ row.original.eventCount || 0 }}</span>
            </template>

            <template #actions-cell="{ row }">
              <UButton
                icon="i-lucide-eye"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="selectJob(row.original)"
              >
                查看
              </UButton>
            </template>

            <template #empty>
              <div class="flex flex-col items-center justify-center px-4 py-12 text-center">
                <div class="flex size-11 items-center justify-center rounded-lg border border-default bg-elevated">
                  <UIcon name="i-lucide-history" class="size-5 text-primary" />
                </div>
                <p class="mt-3 text-sm font-medium">
                  暂无历史记录
                </p>
                <p class="mt-1 text-xs text-muted">
                  执行任务并启用 Data Runtime 后，记录会显示在这里。
                </p>
              </div>
            </template>
          </UTable>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{{ totalText }}</span>
          <UPagination
            v-if="total > pageSize"
            v-model="page"
            :total="total"
            :items-per-page="pageSize"
          />
        </div>

        <section
          v-if="selectedJob"
          class="rounded-md border border-default bg-default"
        >
          <div class="flex flex-wrap items-start justify-between gap-3 border-b border-default px-4 py-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="statusColor(selectedJob.status)"
                  variant="soft"
                >
                  {{ selectedJob.status }}
                </UBadge>
                <span class="truncate font-mono text-xs text-muted">{{ selectedJob.id }}</span>
              </div>
              <h2 class="mt-2 text-base font-semibold">
                {{ selectedJob.prompt || selectedJob.type || '任务详情' }}
              </h2>
            </div>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              square
              @click="selectedJob = null"
            />
          </div>

          <div class="grid gap-4 p-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <dl class="grid content-start gap-3 text-sm">
              <div>
                <dt class="text-xs text-muted">
                  仓库
                </dt>
                <dd class="mt-1">
                  {{ selectedJob.repoId || '-' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  模板
                </dt>
                <dd class="mt-1">
                  {{ selectedJob.templateId || '-' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  创建人
                </dt>
                <dd class="mt-1">
                  {{ selectedJob.createdBy || '-' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  时间
                </dt>
                <dd class="mt-1 space-y-1">
                  <div>创建 {{ formatClock(selectedJob.createdAt) }}</div>
                  <div>开始 {{ formatClock(selectedJob.startedAt) }}</div>
                  <div>结束 {{ formatClock(selectedJob.finishedAt) }}</div>
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  退出码
                </dt>
                <dd class="mt-1">
                  {{ selectedJob.exitCode ?? '-' }}
                </dd>
              </div>
            </dl>

            <div class="min-w-0 space-y-4">
              <div
                v-if="selectedJob.prompt"
                class="rounded-md border border-default bg-elevated/30 p-3"
              >
                <div class="mb-2 text-xs text-muted">
                  指令
                </div>
                <p class="whitespace-pre-wrap break-words text-sm">
                  {{ selectedJob.prompt }}
                </p>
              </div>

              <UAlert
                v-if="selectedJob.error"
                color="error"
                variant="soft"
                icon="i-lucide-circle-alert"
                :title="selectedJob.error"
              />

              <div class="rounded-md border border-default bg-elevated/30">
                <div class="flex items-center justify-between border-b border-default px-3 py-2">
                  <div class="flex items-center gap-2 text-sm font-medium">
                    <UIcon name="i-lucide-list-tree" class="size-4 text-primary" />
                    日志事件
                  </div>
                  <UBadge color="neutral" variant="subtle">
                    {{ selectedEvents.length }}
                  </UBadge>
                </div>

                <div
                  v-if="eventsLoading"
                  class="space-y-2 p-3"
                >
                  <USkeleton class="h-4 w-2/3" />
                  <USkeleton class="h-4 w-5/6" />
                  <USkeleton class="h-4 w-1/2" />
                </div>

                <div
                  v-else-if="selectedEvents.length"
                  class="max-h-96 overflow-auto p-3"
                >
                  <JobEventStream
                    :events="selectedEvents"
                    compact
                  />
                </div>

                <div
                  v-else
                  class="px-3 py-8 text-center text-sm text-muted"
                >
                  暂无日志事件
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
