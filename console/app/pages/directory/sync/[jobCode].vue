<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

const route = useRoute()
const jobCode = computed(() => String(route.params.jobCode || ''))
usePageTitle('同步任务详情')
const UBadge = resolveComponent('UBadge')

interface DirectorySyncJob {
  jobCode: string
  providerCode: string
  syncType: string
  objectScope: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  requestedBy: string | null
  totalCount: number
  createdCount: number
  updatedCount: number
  deletedCount: number
  skippedCount: number
  errorCount: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

interface DirectorySyncEvent {
  id: number
  jobCode: string
  objectType: string
  objectCode: string
  changeType: string
  sourceProvider: string
  externalRef: string | null
  status: string
  message: string | null
  beforeHash: string | null
  afterHash: string | null
  createdAt: string
}

interface ApiResponse<T> {
  code: number
  data: T
}

const { data: jobData, pending: jobPending, error: jobError, refresh: refreshJob } = await useFetch<ApiResponse<DirectorySyncJob>>(
  () => `/api/v1/console/directory/sync-jobs/${jobCode.value}`,
  { watch: [jobCode] }
)

const { data: eventData, pending: eventsPending, error: eventsError, refresh: refreshEvents } = await useFetch<ApiResponse<DirectorySyncEvent[]>>(
  () => `/api/v1/console/directory/sync-jobs/${jobCode.value}/events`,
  {
    query: { limit: 200 },
    default: () => ({ code: 0, data: [] }),
    watch: [jobCode]
  }
)

const job = computed(() => jobData.value?.data)
const events = computed(() => eventData.value?.data || [])

const counters = computed(() => [
  { label: '总数', value: job.value?.totalCount || 0 },
  { label: '新增', value: job.value?.createdCount || 0 },
  { label: '更新', value: job.value?.updatedCount || 0 },
  { label: '删除', value: job.value?.deletedCount || 0 },
  { label: '跳过', value: job.value?.skippedCount || 0 },
  { label: '错误', value: job.value?.errorCount || 0 }
])

function statusMeta(status: string) {
  if (status === 'success') return { label: '成功', color: 'success' as const }
  if (status === 'running') return { label: '运行中', color: 'warning' as const }
  if (status === 'failed') return { label: '失败', color: 'error' as const }
  if (status === 'partial_success') return { label: '部分成功', color: 'warning' as const }
  if (status === 'skipped') return { label: '跳过', color: 'neutral' as const }
  return { label: status, color: 'neutral' as const }
}

function eventStatusColor(status: string) {
  if (status === 'success') return 'success' as const
  if (status === 'failed') return 'error' as const
  return 'neutral' as const
}

const eventColumns: TableColumn<DirectorySyncEvent>[] = [
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => h(UBadge, { color: eventStatusColor(row.original.status), variant: 'soft' }, () => row.original.status)
  },
  {
    id: 'object',
    header: '对象',
    cell: ({ row }) => h('div', [
      h('p', { class: 'font-medium' }, row.original.objectType),
      h('p', { class: 'text-xs text-muted' }, row.original.objectCode)
    ])
  },
  {
    accessorKey: 'changeType',
    header: '变更',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.changeType)
  },
  {
    id: 'source',
    header: '来源',
    cell: ({ row }) => h('div', { class: 'text-muted' }, [
      h('p', row.original.sourceProvider),
      h('p', { class: 'text-xs' }, row.original.externalRef || '-')
    ])
  },
  {
    accessorKey: 'message',
    header: '消息',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.message || '-')
  },
  {
    accessorKey: 'createdAt',
    header: '时间',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.createdAt)
  }
]

async function refreshAll() {
  await Promise.all([refreshJob(), refreshEvents()])
}
</script>

<template>
  <UDashboardPanel id="directory-sync-job-detail" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="同步任务详情">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/directory/sync"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
          >
            返回列表
          </UButton>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="jobPending || eventsPending"
            @click="refreshAll"
          >
            刷新
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="jobError"
        color="error"
        variant="soft"
        title="任务加载失败"
        :description="jobError.message"
      />

      <template v-if="job">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="font-semibold">
                  {{ job.jobCode }}
                </h2>
                <p class="text-sm text-muted">
                  {{ job.providerCode }} / {{ job.syncType }} / {{ job.objectScope }}
                </p>
              </div>
              <UBadge :color="statusMeta(job.status).color" variant="soft">
                {{ statusMeta(job.status).label }}
              </UBadge>
            </div>
          </template>

          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div
              v-for="counter in counters"
              :key="counter.label"
              class="rounded-lg border border-default bg-muted/20 p-3"
            >
              <p class="text-xs text-muted">
                {{ counter.label }}
              </p>
              <p class="mt-1 text-xl font-semibold">
                {{ counter.value }}
              </p>
            </div>
          </div>

          <UAlert
            v-if="job.errorMessage"
            color="error"
            variant="soft"
            title="错误信息"
            :description="job.errorMessage"
            class="mt-4"
          />

          <div class="mt-4 grid gap-3 text-sm text-muted lg:grid-cols-4">
            <p>请求人：{{ job.requestedBy || '-' }}</p>
            <p>开始：{{ job.startedAt || '-' }}</p>
            <p>结束：{{ job.finishedAt || '-' }}</p>
            <p>创建：{{ job.createdAt }}</p>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div>
              <h2 class="font-semibold">
                同步事件
              </h2>
              <p class="text-sm text-muted">
                展示最近 200 条 `directory_sync_events`。
              </p>
            </div>
          </template>

          <UAlert
            v-if="eventsError"
            color="error"
            variant="soft"
            title="事件加载失败"
            :description="eventsError.message"
            class="mb-3"
          />

          <UTable
            sticky
            :data="events"
            :columns="eventColumns"
            :loading="eventsPending"
            empty="暂无同步事件"
            class="flex-1 max-h-[calc(100svh-30rem)] rounded-lg border border-default"
          />
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>
