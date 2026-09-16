<script setup lang="ts">
import WebTerminal, { type TerminalLine } from '~/components/webdev/WebTerminal.vue'

type Severity = 'high' | 'mid' | 'low'

type IssueContext = {
  url?: string
  route?: string
  appVersion?: string
  env?: { ua?: string, os?: string, stage?: string }
  consoleErrors?: Array<{ level?: string, message?: string, at?: string }>
  screenshotUri?: string
}

type Issue = {
  id: string
  displayNo?: number
  appCode?: string
  scope?: string
  pageKey?: string
  pageUrl?: string
  repoId?: string
  severity?: Severity
  kind?: string
  state?: string
  title?: string
  description?: string
  reporterUid?: string
  reporterName?: string
  context?: IssueContext
  linkedJobId?: string
  createdAt?: string
}

type IssueListResponse = {
  items: Issue[]
  total: number
}

usePageTitle('Issue 收件箱')

const toast = useToast()
const router = useRouter()
const { resolveCurrentAppPath } = useAppUrls()
const { setRefresh, clearRefresh } = usePageActions()

const issues = ref<Issue[]>([])
const loading = ref(false)
const claiming = ref(false)
const selectedId = ref<string | null>(null)
const reporterOpen = ref(false)

type StateFilter = { label: string, value: string }
const stateFilters: StateFilter[] = [
  { label: '全部', value: 'all' },
  { label: '待领取', value: 'open' },
  { label: '修复中', value: 'in_progress' },
  { label: '待验证', value: 'verifying' },
  { label: '已解决', value: 'resolved' }
]
const activeState = ref('all')

const SEV_META: Record<Severity, { label: string, color: 'error' | 'warning' | 'neutral', icon: string, iconClass: string }> = {
  high: { label: '高', color: 'error', icon: 'i-lucide-circle-alert', iconClass: 'text-error' },
  mid: { label: '中', color: 'warning', icon: 'i-lucide-triangle-alert', iconClass: 'text-warning' },
  low: { label: '低', color: 'neutral', icon: 'i-lucide-circle', iconClass: 'text-muted' }
}

type StateColor = 'neutral' | 'info' | 'warning' | 'success'
const STATE_META: Record<string, { label: string, color: StateColor }> = {
  open: { label: '待领取', color: 'neutral' },
  claiming: { label: '领取中', color: 'info' },
  in_progress: { label: '修复中', color: 'info' },
  verifying: { label: '待验证', color: 'warning' },
  resolved: { label: '已解决', color: 'success' },
  closed: { label: '已关闭', color: 'neutral' }
}

const STATE_FALLBACK: { label: string, color: StateColor } = { label: '待领取', color: 'neutral' }

function sevMeta(sev: Severity | undefined) {
  return SEV_META[sev || 'mid']
}
function stateMeta(state: string | undefined) {
  return STATE_META[state || 'open'] || STATE_FALLBACK
}

const filtered = computed(() => {
  if (activeState.value === 'all') return issues.value
  return issues.value.filter(issue => issue.state === activeState.value)
})

const selected = computed<Issue | null>(() => {
  if (!filtered.value.length) return null
  return filtered.value.find(issue => issue.id === selectedId.value) || filtered.value[0] || null
})

function stateCount(value: string) {
  if (value === 'all') return issues.value.length
  return issues.value.filter(issue => issue.state === value).length
}

const consoleLines = computed<TerminalLine[]>(() => {
  const errors = selected.value?.context?.consoleErrors || []
  if (!errors.length) return [{ t: 'dim', s: '无控制台错误' }]
  return errors.map(err => ({
    t: (err.level === 'error' ? 'err' : 'dim') as TerminalLine['t'],
    s: [err.message, err.at ? `  at ${err.at}` : ''].filter(Boolean).join('')
  }))
})

function fetchErrorDescription(error: unknown, fallback: string) {
  const err = error as { data?: { statusMessage?: string, message?: string }, message?: string }
  return err?.data?.statusMessage || err?.data?.message || err?.message || fallback
}

function relativeTime(value: string | undefined) {
  return webdevRelativeTime(value)
}

async function loadIssues() {
  loading.value = true
  try {
    const response = await $fetch<IssueListResponse>(resolveCurrentAppPath('/api/webdev/issues'), {
      query: { page: 1, pageSize: 100 }
    })
    issues.value = response.items || []
    if (!issues.value.some(issue => issue.id === selectedId.value)) {
      selectedId.value = issues.value[0]?.id || null
    }
  } catch (error: unknown) {
    issues.value = []
    toast.add({
      title: 'Issue 加载失败',
      description: fetchErrorDescription(error, '无法读取 Issue 收件箱'),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    loading.value = false
  }
}

async function claimIssue(issue: Issue) {
  if (claiming.value) return
  claiming.value = true
  try {
    const result = await $fetch<{ jobId?: string }>(resolveCurrentAppPath(`/api/webdev/issues/${encodeURIComponent(issue.id)}/claim`), {
      method: 'POST'
    })
    toast.add({
      title: '已创建 Agent 任务',
      description: `${issue.appCode || ''} · 任务已加入队列`.trim(),
      color: 'primary',
      icon: 'i-lucide-sparkles'
    })
    router.push(result.jobId ? `/?job=${encodeURIComponent(result.jobId)}` : '/')
  } catch (error: unknown) {
    toast.add({
      title: '领取失败',
      description: fetchErrorDescription(error, '无法为该 Issue 创建 Agent 任务'),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    claiming.value = false
  }
}

function openLinkedJob(issue: Issue) {
  router.push(issue.linkedJobId ? `/?job=${encodeURIComponent(issue.linkedJobId)}` : '/')
}

watch(activeState, () => {
  if (!filtered.value.some(issue => issue.id === selectedId.value)) {
    selectedId.value = filtered.value[0]?.id || null
  }
})

onMounted(() => {
  setRefresh(loadIssues)
  loadIssues()
})

onBeforeUnmount(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel
    id="webdev-issues"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-hidden p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #body>
      <div class="flex h-full min-h-0">
        <!-- 列表 -->
        <div class="flex min-w-0 flex-1 flex-col border-r border-default">
          <div class="flex items-center gap-1.5 overflow-x-auto border-b border-default px-4 py-2.5">
            <UButton
              v-for="filter in stateFilters"
              :key="filter.value"
              :variant="filter.value === activeState ? 'solid' : 'soft'"
              color="neutral"
              size="xs"
              class="shrink-0 rounded-full"
              @click="activeState = filter.value"
            >
              {{ filter.label }} {{ stateCount(filter.value) }}
            </UButton>
            <UButton
              class="ml-auto shrink-0"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="loading"
              @click="loadIssues"
            />
          </div>

          <div class="min-h-0 flex-1 overflow-auto">
            <button
              v-for="issue in filtered"
              :key="issue.id"
              type="button"
              class="flex w-full items-start gap-3 border-b border-default px-4 py-3 text-left transition-colors"
              :class="issue.id === selected?.id ? 'border-l-2 border-l-primary bg-primary/5' : 'border-l-2 border-l-transparent hover:bg-elevated/40'"
              @click="selectedId = issue.id"
            >
              <UIcon
                :name="sevMeta(issue.severity).icon"
                class="mt-0.5 size-4 shrink-0"
                :class="sevMeta(issue.severity).iconClass"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[11px] text-muted">#{{ issue.displayNo ?? '—' }}</span>
                  <span class="truncate text-sm font-medium">{{ issue.title }}</span>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    class="font-mono"
                  >
                    {{ issue.appCode || '-' }}
                  </UBadge>
                  <UBadge
                    v-if="issue.scope === 'app'"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                  >
                    全局
                  </UBadge>
                  <span class="ml-auto text-[11px] text-muted">{{ issue.reporterName || issue.reporterUid || '-' }} · {{ relativeTime(issue.createdAt) }}</span>
                </div>
              </div>
              <div class="flex flex-col items-end gap-1.5">
                <UBadge :color="stateMeta(issue.state).color" variant="soft" size="sm">
                  {{ stateMeta(issue.state).label }}
                </UBadge>
                <span v-if="issue.linkedJobId" class="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                  <UIcon name="i-lucide-sparkles" class="size-3" />Agent 已领取
                </span>
              </div>
            </button>

            <div
              v-if="!loading && !filtered.length"
              class="flex flex-col items-center justify-center px-4 py-16 text-center"
            >
              <div class="flex size-11 items-center justify-center rounded-lg border border-default bg-elevated">
                <UIcon name="i-lucide-inbox" class="size-5 text-primary" />
              </div>
              <p class="mt-3 text-sm font-medium">
                暂无 Issue
              </p>
              <p class="mt-1 text-xs text-muted">
                业务应用通过 Foundation 报告组件提交后会显示在这里。
              </p>
            </div>
          </div>
        </div>

        <!-- 详情 -->
        <div
          v-if="selected"
          class="flex w-[28rem] shrink-0 flex-col gap-3 overflow-auto p-4"
        >
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-xs text-muted">#{{ selected.displayNo ?? '—' }}</span>
              <UBadge
                :color="sevMeta(selected.severity).color"
                variant="soft"
                size="sm"
                class="gap-1"
              >
                <UIcon :name="sevMeta(selected.severity).icon" class="size-3" />{{ sevMeta(selected.severity).label }}
              </UBadge>
              <UBadge :color="stateMeta(selected.state).color" variant="soft" size="sm">
                {{ stateMeta(selected.state).label }}
              </UBadge>
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ selected.scope === 'app' ? '全局级' : '页面级' }}
              </UBadge>
            </div>
            <h2 class="mt-2 text-base font-semibold leading-snug">
              {{ selected.title }}
            </h2>
            <p class="mt-1 text-xs text-muted">
              {{ selected.reporterName || selected.reporterUid || '-' }} · {{ relativeTime(selected.createdAt) }} · 来源 {{ selected.appCode || '-' }}
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="selected.linkedJobId"
              icon="i-lucide-sparkles"
              color="primary"
              size="sm"
              @click="openLinkedJob(selected)"
            >
              查看 Agent 任务
            </UButton>
            <UButton
              v-else
              icon="i-lucide-sparkles"
              color="primary"
              size="sm"
              :loading="claiming"
              @click="claimIssue(selected)"
            >
              创建 Agent 任务
            </UButton>
            <UButton
              icon="i-lucide-user-round-plus"
              color="neutral"
              variant="outline"
              size="sm"
              disabled
            >
              指派
            </UButton>
          </div>

          <UCard :ui="{ body: 'p-3 sm:p-3' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-scan-search" class="size-4 text-muted" />
                <span class="text-xs font-semibold">自动采集上下文</span>
              </div>
            </template>
            <dl class="flex flex-col gap-1.5 text-xs">
              <div v-if="selected.context?.url || selected.pageUrl" class="flex gap-2">
                <dt class="w-12 shrink-0 text-muted">
                  页面
                </dt>
                <dd class="break-all font-mono text-default">
                  {{ selected.context?.url || selected.pageUrl }}
                </dd>
              </div>
              <div v-if="selected.pageKey" class="flex gap-2">
                <dt class="w-12 shrink-0 text-muted">
                  路由
                </dt>
                <dd class="break-all font-mono text-default">
                  {{ selected.pageKey }}
                </dd>
              </div>
              <div v-if="selected.context?.env" class="flex gap-2">
                <dt class="w-12 shrink-0 text-muted">
                  环境
                </dt>
                <dd class="text-default">
                  {{ [selected.context.env.ua, selected.context.env.os, selected.context.env.stage].filter(Boolean).join(' · ') }}
                </dd>
              </div>
            </dl>
            <div class="mt-3">
              <div class="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                <UIcon name="i-lucide-bug" class="size-3" />控制台错误
              </div>
              <WebTerminal :lines="consoleLines" />
            </div>
          </UCard>

          <UCard v-if="selected.description" :ui="{ body: 'p-3 sm:p-3' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-message-square-text" class="size-4 text-muted" />
                <span class="text-xs font-semibold">用户补充描述</span>
              </div>
            </template>
            <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-default">
              {{ selected.description }}
            </p>
          </UCard>

          <UButton
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-megaphone"
            class="border-dashed"
            @click="reporterOpen = true"
          >
            预览用户端「报告问题」组件
          </UButton>
        </div>
      </div>

      <!-- Foundation 报告组件预览（阶段 3 落地为真实共享组件） -->
      <UModal v-model:open="reporterOpen" title="报告问题 · Foundation 通用组件预览">
        <template #body>
          <div class="flex flex-col gap-3">
            <UAlert
              color="info"
              variant="soft"
              icon="i-lucide-info"
              title="原型预览"
              description="Foundation 通用报告组件将在阶段 3 落地：自动采集页面、控制台错误与截图，用户仅需补充标题与描述。"
            />
            <p class="text-xs text-muted">
              业务应用内嵌「反馈」入口 → 经 Foundation server proxy（Console service token）提交至 WebDev intake → 写入本收件箱。
            </p>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end">
            <UButton color="neutral" variant="ghost" @click="reporterOpen = false">
              关闭
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
