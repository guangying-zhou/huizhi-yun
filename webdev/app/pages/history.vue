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

type RuntimeInstanceConflictPrincipal = {
  kind: string
  uid: string
  matchesActor: boolean
}

type RuntimeInstanceConflictExplanation = {
  tenantCode: string
  uid: string
  requested: {
    appCode: string
    resourceCode: string
    action: string
  }
  principals: RuntimeInstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: Array<{
    ruleCode?: string
    ruleName?: string
    enforcement?: string
    status?: string
    reasonCode?: string
    message?: string
    counterpart?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
    requested?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
  }>
}

type WebDevInstanceConflictExplainData = {
  targetType: 'job'
  id: string
  code: string | null
  action: 'deploy'
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplanation
}

type ApiResponse<T> = {
  code?: number
  data?: T
  message?: string
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
const conflictModalOpen = ref(false)
const conflictLoading = ref(false)
const conflictTarget = ref<Job | null>(null)
const conflictResult = ref<WebDevInstanceConflictExplainData | null>(null)

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

function conflictDecisionColor(result: RuntimeInstanceConflictExplanation | null | undefined): BadgeColor {
  if (!result) return 'neutral'
  if (result.hasBlockingViolation) return 'error'
  if (result.hasWarningViolation || result.hasViolation) return 'warning'
  return 'success'
}

function conflictDecisionLabel(result: RuntimeInstanceConflictExplanation | null | undefined) {
  if (!result) return '未解释'
  if (result.hasBlockingViolation) return '阻断风险'
  if (result.hasWarningViolation || result.hasViolation) return '预警风险'
  return '未触发'
}

function conflictRuleStatusColor(status: unknown): BadgeColor {
  if (status === 'violated') return 'warning'
  if (status === 'satisfied') return 'success'
  return 'neutral'
}

function conflictRuleStatusLabel(status: unknown) {
  if (status === 'violated') return '已触发'
  if (status === 'satisfied') return '已通过'
  return '未适用'
}

function permissionText(permission: { appCode?: string, resourceCode?: string, action?: string } | null | undefined) {
  if (!permission) return '-'
  return [permission.appCode, permission.resourceCode, permission.action].filter(Boolean).join(':') || '-'
}

function principalLabel(kind: string) {
  const labels: Record<string, string> = {
    requester: '发起人',
    executor: '执行人'
  }
  return labels[kind] || kind
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

async function openConflictExplanation(job: Job) {
  conflictTarget.value = job
  conflictResult.value = null
  conflictModalOpen.value = true
  conflictLoading.value = true
  try {
    const response = await $fetch<ApiResponse<WebDevInstanceConflictExplainData>>(apiPath('/api/webdev/authorization/instance-conflict-explain'), {
      method: 'POST',
      body: {
        targetType: 'job',
        id: job.id,
        action: 'deploy'
      }
    })
    if (!response.data) {
      throw new Error(response.message || '实例职责冲突解释结果为空。')
    }
    conflictResult.value = response.data
  } catch (error: unknown) {
    toast.add({
      title: '部署职责冲突解释失败',
      description: fetchErrorDescription(error, '无法解释该任务的部署职责冲突'),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
    conflictModalOpen.value = false
  } finally {
    conflictLoading.value = false
  }
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
              <div class="flex items-center justify-end gap-1">
                <UButton
                  icon="i-lucide-shield-alert"
                  color="warning"
                  variant="soft"
                  size="xs"
                  :loading="conflictLoading && conflictTarget?.id === row.original.id"
                  @click="openConflictExplanation(row.original)"
                >
                  冲突
                </UButton>
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="selectJob(row.original)"
                >
                  查看
                </UButton>
              </div>
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

        <UModal
          v-model:open="conflictModalOpen"
          title="部署职责冲突解释"
          :description="conflictTarget ? `任务 ${conflictTarget.id}` : 'WebDev 部署风险解释'"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <div
              v-if="conflictLoading"
              class="flex min-h-36 items-center justify-center gap-2 text-sm text-muted"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />
              正在解释部署职责冲突...
            </div>

            <div
              v-else-if="conflictResult"
              class="space-y-4"
            >
              <UAlert
                :color="conflictDecisionColor(conflictResult.explanation)"
                variant="soft"
                icon="i-lucide-shield-alert"
                :title="conflictDecisionLabel(conflictResult.explanation)"
                :description="`${conflictResult.explanation.requested.appCode}:${conflictResult.explanation.requested.resourceCode}:${conflictResult.explanation.requested.action}`"
              />

              <div class="rounded-md border border-default bg-elevated/40 px-4 py-3">
                <div class="flex flex-wrap gap-1.5">
                  <UBadge
                    v-for="principal in conflictResult.explanation.principals"
                    :key="`${principal.kind}:${principal.uid}`"
                    :color="principal.matchesActor ? 'warning' : 'neutral'"
                    variant="soft"
                    class="font-mono"
                  >
                    {{ principalLabel(principal.kind) }}={{ principal.uid }}
                  </UBadge>
                  <span
                    v-if="conflictResult.explanation.principals.length === 0"
                    class="text-sm text-muted"
                  >
                    当前任务没有可解释的发起人或执行人主体。
                  </span>
                </div>
              </div>

              <div
                v-if="conflictResult.explanation.rules.length > 0"
                class="grid gap-2"
              >
                <div
                  v-for="rule in conflictResult.explanation.rules"
                  :key="String(rule.ruleCode || rule.ruleName)"
                  class="rounded-md border border-default bg-default px-4 py-3"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="font-semibold text-highlighted">
                      {{ rule.ruleName || rule.ruleCode }}
                    </p>
                    <UBadge
                      :color="conflictRuleStatusColor(rule.status)"
                      variant="soft"
                    >
                      {{ conflictRuleStatusLabel(rule.status) }}
                    </UBadge>
                    <UBadge
                      :color="rule.enforcement === 'enforce' ? 'error' : 'warning'"
                      variant="soft"
                    >
                      {{ rule.enforcement || 'warning' }}
                    </UBadge>
                  </div>
                  <p class="mt-2 text-sm text-muted">
                    {{ rule.message || rule.reasonCode || '未返回解释消息' }}
                  </p>
                  <p class="mt-2 font-mono text-xs text-muted">
                    {{ permissionText(rule.counterpart?.permission) }}
                    ↔
                    {{ permissionText(rule.requested?.permission) }}
                  </p>
                </div>
              </div>

              <div
                v-else
                class="rounded-md border border-dashed border-default bg-elevated/30 px-4 py-6 text-center text-sm text-muted"
              >
                当前部署动作未命中 active 职责冲突规则。
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
