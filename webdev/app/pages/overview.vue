<script setup lang="ts">
type Job = {
  id: string
  type: string
  status: string
  repoId?: string
  templateId?: string
  prompt?: string
  createdBy?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  eventCount?: number
}

type JobListResponse = {
  items: Job[]
  total: number
}

type ModuleMeta = {
  m: string
  port: number
  desc: string
  envs: string[]
}

usePageTitle('总览')

const { resolveCurrentAppPath } = useAppUrls()
const { setRefresh, clearRefresh } = usePageActions()

const jobs = ref<Job[]>([])
const total = ref(0)
const loading = ref(false)

const terminalStatuses = new Set(['succeeded', 'failed', 'canceled'])

// 模块清单对齐根 CLAUDE.md 端口速览
const MODULES: ModuleMeta[] = [
  { m: 'finance', port: 3006, desc: '经营财务中台', envs: ['preview', 'staging', 'prod'] },
  { m: 'workflow', port: 3020, desc: '通用审批流程', envs: ['preview', 'staging', 'prod'] },
  { m: 'codocs', port: 3001, desc: '协作文档', envs: ['preview', 'prod'] },
  { m: 'aims', port: 3002, desc: '研发项目管理', envs: ['staging'] },
  { m: 'altoc', port: 3003, desc: 'LTC 经营管理', envs: ['prod'] },
  { m: 'console', port: 3000, desc: '企业基础运行时', envs: ['prod'] }
]

const runningCount = computed(() => jobs.value.filter(job => !terminalStatuses.has(job.status)).length)
const weekTaskCount = computed(() => total.value || jobs.value.length)

const successRate = computed(() => {
  const terminal = jobs.value.filter(job => terminalStatuses.has(job.status))
  if (!terminal.length) return '-'
  const ok = terminal.filter(job => job.status === 'succeeded').length
  return `${Math.round((ok / terminal.length) * 100)}%`
})

const failedCount = computed(() => jobs.value.filter(job => job.status === 'failed').length)

const ICON_COLOR_CLASS: Record<string, string> = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
  primary: 'text-primary',
  neutral: 'text-muted'
}

const recentActivity = computed(() => {
  return jobs.value.slice(0, 6).map((job) => {
    const meta = webdevStatusMeta(job.status)
    return {
      id: job.id,
      icon: meta.icon,
      colorClass: ICON_COLOR_CLASS[meta.color] || 'text-muted',
      title: job.prompt || job.type || '任务',
      sub: `${webdevRelativeTime(job.createdAt)} · ${job.repoId || job.templateId || 'codex'}`
    }
  })
})

function moduleJobCount(name: string) {
  return jobs.value.filter(job => job.repoId === name).length
}

async function loadJobs() {
  loading.value = true
  try {
    const response = await $fetch<JobListResponse>(resolveCurrentAppPath('/api/webdev/jobs'), { query: { page: 1, pageSize: 50 } })
    jobs.value = response.items || []
    total.value = response.total || jobs.value.length
  } catch {
    jobs.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  setRefresh(loadJobs)
  loadJobs()
})

onBeforeUnmount(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel
    id="webdev-overview"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-auto p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold">
              总览 · huizhi-yun
            </h1>
            <p class="mt-1 text-sm text-muted">
              远程 Agent 任务、部署与 Issue 处理的整体视图。
            </p>
          </div>
          <UButton
            to="/"
            icon="i-lucide-plus"
            color="primary"
          >
            新建任务
          </UButton>
        </div>

        <!-- 指标卡 -->
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UPageCard
            icon="i-lucide-square-terminal"
            title="任务总量"
            :description="`运行中 ${runningCount}`"
            spotlight
          >
            <template #footer>
              <span class="text-3xl font-bold tracking-tight">{{ weekTaskCount }}</span>
            </template>
          </UPageCard>
          <UPageCard
            icon="i-lucide-circle-check"
            title="任务成功率"
            :description="`失败 ${failedCount} · 多为 typecheck`"
          >
            <template #footer>
              <span class="text-3xl font-bold tracking-tight">{{ successRate }}</span>
            </template>
          </UPageCard>
          <UPageCard
            icon="i-lucide-rocket"
            title="本周部署"
            description="production 均需人工确认"
          >
            <template #footer>
              <span class="text-3xl font-bold tracking-tight text-muted">—</span>
            </template>
          </UPageCard>
          <UPageCard
            icon="i-lucide-inbox"
            title="待处理 Issue"
            description="示例数据 · 待接入收件箱"
          >
            <template #footer>
              <span class="text-3xl font-bold tracking-tight text-muted">—</span>
            </template>
          </UPageCard>
        </div>

        <div class="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <!-- 模块 -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-boxes" class="size-4 text-muted" />
                <span class="text-sm font-semibold">模块</span>
              </div>
            </template>
            <div class="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              <div
                v-for="mod in MODULES"
                :key="mod.m"
                class="flex flex-col gap-2 rounded-xl border border-default p-3"
              >
                <div class="flex items-center gap-2">
                  <span class="font-mono text-sm font-bold">{{ mod.m }}</span>
                  <span class="font-mono text-[10px] text-muted">:{{ mod.port }}</span>
                  <UBadge
                    v-if="moduleJobCount(mod.m)"
                    class="ml-auto"
                    color="primary"
                    variant="soft"
                    size="sm"
                  >
                    {{ moduleJobCount(mod.m) }} 任务
                  </UBadge>
                </div>
                <p class="text-xs text-muted">
                  {{ mod.desc }}
                </p>
                <div class="flex flex-wrap items-center gap-1.5">
                  <UBadge
                    v-for="env in mod.envs"
                    :key="env"
                    :color="env === 'prod' ? 'warning' : 'neutral'"
                    variant="subtle"
                    size="sm"
                    class="font-mono"
                  >
                    {{ env }}
                  </UBadge>
                </div>
              </div>
            </div>
          </UCard>

          <!-- 最近活动 -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-activity" class="size-4 text-muted" />
                <span class="text-sm font-semibold">最近活动</span>
              </div>
            </template>
            <div class="divide-y divide-default">
              <div
                v-for="item in recentActivity"
                :key="item.id"
                class="flex items-start gap-3 px-4 py-2.5"
              >
                <UIcon
                  :name="item.icon"
                  class="mt-0.5 size-4 shrink-0"
                  :class="item.colorClass"
                />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">
                    {{ item.title }}
                  </div>
                  <div class="mt-0.5 text-xs text-muted">
                    {{ item.sub }}
                  </div>
                </div>
              </div>
              <div
                v-if="!loading && !recentActivity.length"
                class="px-4 py-10 text-center text-sm text-muted"
              >
                暂无活动记录
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
