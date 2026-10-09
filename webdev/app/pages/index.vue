<script setup lang="ts">
import JobEventStream from '~/components/webdev/JobEventStream.vue'

type AgentTemplate = {
  id: string
  type: string
  repoId: string
  cwd: string
  runner?: string
  codexSandboxPolicy?: string
  timeoutSec?: number
}

type AgentEnrollment = {
  agentId: string
  version: string
  templates: AgentTemplate[]
}

type Job = {
  id: string
  type: string
  status: string
  repoId?: string
  templateId: string
  attachments?: UploadedAttachment[]
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  error?: string
  prompt?: string
  eventCount: number
}

type JobEvent = {
  sequence: number
  level: string
  message: string
  createdAt: string
}

type UploadedAttachment = {
  id: string
  filename: string
  contentType?: string
  size?: number
  sha256?: string
  createdAt?: string
}

type JobListResponse = {
  items: Job[]
  total: number
  page: number
  pageSize: number
}

type BadgeColor = 'success' | 'error' | 'warning' | 'info' | 'neutral'
type PromptSubmitStatus = 'ready' | 'submitted' | 'streaming' | 'error'
type TaskFilter = '全部' | '运行中' | '已结束'

const CODEX_APP_SERVER_TEMPLATE_ID = 'codex.app-server'
const CODEX_EXEC_TEMPLATE_ID = 'codex.exec'
const CODEX_TEMPLATE_IDS = [CODEX_APP_SERVER_TEMPLATE_ID, CODEX_EXEC_TEMPLATE_ID]
const MAX_ATTACHMENT_FILES = 8
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

usePageTitle('任务')

const toast = useToast()
const route = useRoute()
const { resolveCurrentAppPath } = useAppUrls()
const { setRefresh, clearRefresh } = usePageActions()

const enrollment = ref<AgentEnrollment | null>(null)
const jobs = ref<Job[]>([])
const jobsLoading = ref(false)
const currentJob = ref<Job | null>(null)
const events = ref<JobEvent[]>([])
const prompt = ref('')
const loading = ref(false)
const uploadingAttachments = ref(false)
const polling = ref(false)
const logContainer = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFiles = ref<File[]>([])
const activePrompt = ref('')
const submitFailed = ref(false)
const now = ref(Date.now())
const taskFilter = ref<TaskFilter>('全部')
let clockTimer: ReturnType<typeof setInterval> | null = null

const terminalStatuses = new Set(['succeeded', 'failed', 'canceled'])
const taskFilters: TaskFilter[] = ['全部', '运行中', '已结束']

const codexTemplate = computed(() => {
  const templates = enrollment.value?.templates || []
  return CODEX_TEMPLATE_IDS
    .map(id => templates.find(item => item.id === id))
    .find(Boolean)
    || templates.find(item => item.type === 'codex_task')
    || null
})

const isJobActive = computed(() => {
  return Boolean(currentJob.value && !terminalStatuses.has(currentJob.value.status))
})

const canSubmit = computed(() => {
  return Boolean(codexTemplate.value && prompt.value.trim() && !loading.value && !uploadingAttachments.value && !isJobActive.value)
})

const agentStatusColor = computed<BadgeColor>(() => (codexTemplate.value ? 'success' : 'warning'))

const promptStatus = computed<PromptSubmitStatus>(() => {
  if (submitFailed.value) return 'error'
  if (loading.value || uploadingAttachments.value) return 'submitted'
  return isJobActive.value ? 'streaming' : 'ready'
})

const chatStatus = computed<PromptSubmitStatus>(() => {
  if (loading.value || uploadingAttachments.value) return 'submitted'
  if (isJobActive.value) return 'streaming'
  if (currentJob.value?.status === 'failed') return 'error'
  return 'ready'
})

const statusText = computed(() => webdevStatusMeta(currentJob.value?.status).label)
const eventCount = computed(() => events.value.length || currentJob.value?.eventCount || 0)
const currentPrompt = computed(() => currentJob.value?.prompt || activePrompt.value)
const canStopOrSubmit = computed(() => canSubmit.value || isJobActive.value)

const conversationMessages = computed(() => {
  if (!currentJob.value) return []
  return [{
    id: `${currentJob.value.id}-prompt`,
    role: 'user',
    parts: [{ type: 'text', text: currentPrompt.value }]
  }, {
    id: `${currentJob.value.id}-events`,
    role: 'assistant',
    parts: [{ type: 'text', text: `${currentJob.value.status}:${eventCount.value}` }]
  }]
})

const jobDurationText = computed(() => {
  if (!currentJob.value?.startedAt) return '-'
  const end = currentJob.value.finishedAt ? new Date(currentJob.value.finishedAt).getTime() : now.value
  return webdevFormatDuration(new Date(currentJob.value.startedAt).getTime(), end)
})

const footerHint = computed(() => {
  if (isJobActive.value) return '任务运行中'
  if (uploadingAttachments.value) return '附件上传中'
  if (!codexTemplate.value) return 'Codex 模板未配置'
  return `${codexTemplate.value.repoId} · ${codexTemplate.value.cwd || '.'}`
})

const filteredJobs = computed(() => {
  if (taskFilter.value === '运行中') {
    return jobs.value.filter(job => !terminalStatuses.has(job.status))
  }
  if (taskFilter.value === '已结束') {
    return jobs.value.filter(job => terminalStatuses.has(job.status))
  }
  return jobs.value
})

const runningCount = computed(() => jobs.value.filter(job => !terminalStatuses.has(job.status)).length)

function apiPath(path: string) {
  return resolveCurrentAppPath(path)
}

function fetchErrorDescription(error: unknown, fallback: string) {
  const err = error as { data?: { statusMessage?: string, message?: string }, message?: string }
  return err?.data?.statusMessage || err?.data?.message || err?.message || fallback
}

function formatClock(value: string | undefined) {
  return webdevFormatClock(value)
}

function formatBytes(value: number | undefined) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function jobTitle(job: Job) {
  const text = (job.prompt || '').trim()
  if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text
  return job.type || '任务'
}

function jobModule(job: Job) {
  return job.repoId || codexTemplate.value?.repoId || '-'
}

function isPromptMessage(message: { id?: string }) {
  return String(message.id || '').endsWith('-prompt')
}

function attachmentFileKey(file: File, index: number) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`
}

function openFilePicker() {
  fileInput.value?.click()
}

function upsertJob(job: Job) {
  const index = jobs.value.findIndex(item => item.id === job.id)
  if (index >= 0) {
    jobs.value.splice(index, 1, { ...jobs.value[index], ...job })
  } else {
    jobs.value.unshift(job)
  }
}

function addFiles(files: File[]) {
  if (!files.length) return
  const next = [...selectedFiles.value]
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.add({ title: '附件过大', description: `${file.name} 超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}`, color: 'warning', icon: 'i-lucide-circle-alert' })
      continue
    }
    if (next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue
    if (next.length >= MAX_ATTACHMENT_FILES) {
      toast.add({ title: '附件数量过多', description: `单次任务最多上传 ${MAX_ATTACHMENT_FILES} 个附件`, color: 'warning', icon: 'i-lucide-circle-alert' })
      break
    }
    next.push(file)
  }
  selectedFiles.value = next
}

function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  addFiles(Array.from(input.files || []))
  input.value = ''
}

function onDropAttachments(event: DragEvent) {
  addFiles(Array.from(event.dataTransfer?.files || []))
}

function onPasteAttachments(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || [])
  if (files.length) addFiles(files)
}

function removeFile(index: number) {
  selectedFiles.value = selectedFiles.value.filter((_, itemIndex) => itemIndex !== index)
}

async function uploadAttachments() {
  if (!selectedFiles.value.length) return []
  uploadingAttachments.value = true
  try {
    const form = new FormData()
    for (const file of selectedFiles.value) {
      form.append('files', file, file.name)
    }
    const result = await $fetch<{ attachments: UploadedAttachment[] }>(apiPath('/api/webdev/attachments'), { method: 'POST', body: form })
    return result.attachments || []
  } finally {
    uploadingAttachments.value = false
  }
}

onMounted(async () => {
  setRefresh(refreshPage)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  await Promise.all([refreshEnrollment(), loadJobs()])

  // 从 Issue 收件箱「查看/创建 Agent 任务」跳转而来时定位对应任务
  const jobQuery = String(route.query.job || '')
  if (jobQuery) {
    const existing = jobs.value.find(item => item.id === jobQuery)
    await selectJob(existing || ({
      id: jobQuery,
      type: 'codex_task',
      status: 'queued',
      templateId: codexTemplate.value?.id || CODEX_APP_SERVER_TEMPLATE_ID,
      createdAt: new Date().toISOString(),
      eventCount: 0
    } as Job))
  }
})

onBeforeUnmount(() => {
  polling.value = false
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
  clearRefresh()
})

watch(() => events.value.length, async () => {
  await nextTick()
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
})

watch(prompt, () => {
  submitFailed.value = false
})

async function refreshPage() {
  await loadJobs()
  if (currentJob.value) await refreshJob()
}

async function loadJobs() {
  jobsLoading.value = true
  try {
    const response = await $fetch<JobListResponse>(apiPath('/api/webdev/jobs'), { query: { page: 1, pageSize: 30 } })
    jobs.value = response.items || []
  } catch {
    // 历史尚未接入 Data Runtime 时，左侧任务列表为空，不打断当前会话
  } finally {
    jobsLoading.value = false
  }
}

async function refreshEnrollment() {
  try {
    enrollment.value = await $fetch<AgentEnrollment>(apiPath('/api/webdev/agent/enrollment'))
  } catch (error: unknown) {
    toast.add({ title: 'Agent 不可用', description: fetchErrorDescription(error, '无法读取 Dev Agent 状态'), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function newTask() {
  polling.value = false
  currentJob.value = null
  events.value = []
  activePrompt.value = ''
  submitFailed.value = false
  selectedFiles.value = []
  prompt.value = ''
}

async function selectJob(job: Job) {
  if (currentJob.value?.id === job.id) return
  polling.value = false
  currentJob.value = job
  events.value = []
  activePrompt.value = job.prompt || ''
  try {
    await refreshJob()
  } catch {
    return
  }
  if (currentJob.value && !terminalStatuses.has(currentJob.value.status)) {
    pollJob(currentJob.value.id)
  }
}

async function createJob() {
  const value = prompt.value.trim()
  if (!value || !codexTemplate.value || isJobActive.value) return

  loading.value = true
  submitFailed.value = false
  events.value = []
  try {
    const attachments = await uploadAttachments()
    const job = await $fetch<Job>(apiPath('/api/webdev/jobs'), {
      method: 'POST',
      body: { type: 'codex_task', templateId: codexTemplate.value.id, prompt: value, attachments }
    })
    activePrompt.value = value
    currentJob.value = { ...job, prompt: job.prompt || value }
    upsertJob(currentJob.value)
    prompt.value = ''
    selectedFiles.value = []
    pollJob(currentJob.value.id)
  } catch (error: unknown) {
    submitFailed.value = true
    toast.add({ title: '任务创建失败', description: fetchErrorDescription(error, '无法创建 Codex 任务'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loading.value = false
  }
}

async function refreshJob() {
  if (!currentJob.value) return
  const jobId = currentJob.value.id
  try {
    const job = await $fetch<Job>(apiPath(`/api/webdev/jobs/${jobId}`))
    currentJob.value = { ...job, prompt: job.prompt || currentJob.value.prompt || activePrompt.value }
    upsertJob(currentJob.value)
    const result = await $fetch<{ events: JobEvent[] }>(apiPath(`/api/webdev/jobs/${jobId}/events`), {
      query: { after: events.value.at(-1)?.sequence || 0 }
    })
    events.value.push(...(result.events || []))
  } catch (error: unknown) {
    polling.value = false
    toast.add({ title: '任务刷新失败', description: fetchErrorDescription(error, '无法读取任务状态或事件'), color: 'error', icon: 'i-lucide-circle-alert' })
    throw error
  }
}

async function pollJob(jobId: string) {
  polling.value = true
  while (polling.value && currentJob.value?.id === jobId) {
    try {
      await refreshJob()
    } catch {
      return
    }
    if (currentJob.value && terminalStatuses.has(currentJob.value.status)) {
      polling.value = false
      return
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
}

async function cancelJob() {
  if (!currentJob.value || terminalStatuses.has(currentJob.value.status)) return
  try {
    const job = await $fetch<Job>(apiPath(`/api/webdev/jobs/${currentJob.value.id}/cancel`), { method: 'POST' })
    currentJob.value = { ...job, prompt: job.prompt || currentJob.value.prompt || activePrompt.value }
    upsertJob(currentJob.value)
    polling.value = false
    await refreshJob()
  } catch (error: unknown) {
    toast.add({ title: '停止任务失败', description: fetchErrorDescription(error, '无法停止当前任务'), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
</script>

<template>
  <UDashboardPanel
    id="webdev"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-hidden p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #header>
      <UDashboardNavbar title="任务工作台">
        <template #right>
          <WebStatusBadge v-if="currentJob" :status="currentJob.status" />
          <UBadge
            v-if="currentJob"
            color="neutral"
            variant="subtle"
            class="max-w-56 truncate font-mono"
          >
            {{ jobModule(currentJob) }}
          </UBadge>
          <UBadge
            :color="agentStatusColor"
            variant="soft"
            class="gap-1.5"
          >
            <UIcon name="i-lucide-radio" class="size-3.5" />
            {{ enrollment?.agentId || 'Agent 离线' }}
          </UBadge>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
            <UBadge v-if="enrollment?.version" color="neutral" variant="subtle">
              {{ enrollment.version }}
            </UBadge>
            <span v-if="currentJob">{{ statusText }}</span>
            <span v-if="currentJob?.startedAt">开始 {{ formatClock(currentJob.startedAt) }}</span>
          </div>
        </template>

        <template #right>
          <div class="flex items-center gap-3 text-xs text-muted">
            <span>事件 {{ eventCount }}</span>
            <span>耗时 {{ jobDurationText }}</span>
            <span>退出码 {{ currentJob?.exitCode ?? '-' }}</span>
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex h-full min-h-0">
        <!-- 任务列表 -->
        <aside class="flex w-72 shrink-0 flex-col border-r border-default bg-default">
          <div class="flex items-center gap-2 px-4 pb-2 pt-3">
            <span class="text-sm font-semibold">任务</span>
            <span class="text-xs text-muted">{{ jobs.length }}</span>
            <UButton
              class="ml-auto"
              icon="i-lucide-plus"
              color="primary"
              size="xs"
              @click="newTask"
            >
              新建任务
            </UButton>
          </div>

          <div class="flex gap-1.5 px-4 pb-2">
            <UButton
              v-for="filter in taskFilters"
              :key="filter"
              :color="filter === taskFilter ? 'neutral' : 'neutral'"
              :variant="filter === taskFilter ? 'solid' : 'soft'"
              size="xs"
              class="rounded-full"
              @click="taskFilter = filter"
            >
              {{ filter }}<template v-if="filter === '运行中' && runningCount">
                {{ runningCount }}
              </template>
            </UButton>
          </div>

          <div class="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3">
            <button
              v-for="job in filteredJobs"
              :key="job.id"
              type="button"
              class="flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors"
              :class="currentJob?.id === job.id ? 'border-primary/40 bg-primary/5' : 'border-default bg-default hover:border-default/80 hover:bg-elevated/40'"
              @click="selectJob(job)"
            >
              <div class="flex items-center gap-2">
                <span class="font-mono text-[11px] text-muted">#{{ job.id.slice(0, 8) }}</span>
                <WebStatusBadge :status="job.status" />
                <span class="ml-auto truncate font-mono text-[11px] text-muted">{{ jobModule(job) }}</span>
              </div>
              <div class="line-clamp-2 text-[13px] font-medium leading-snug">
                {{ jobTitle(job) }}
              </div>
            </button>

            <div
              v-if="!jobsLoading && !filteredJobs.length"
              class="px-2 py-8 text-center text-xs text-muted"
            >
              暂无任务记录
            </div>
          </div>
        </aside>

        <!-- 会话区 -->
        <div class="flex min-w-0 flex-1 flex-col">
          <div
            ref="logContainer"
            class="min-h-0 flex-1 overflow-auto"
          >
            <div class="mx-auto flex min-h-full max-w-4xl flex-col px-4 py-5">
              <div
                v-if="!currentJob"
                class="flex flex-1 flex-col items-center justify-center py-16 text-center"
              >
                <div class="flex size-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/5">
                  <UIcon name="i-lucide-sparkles" class="size-6 text-primary" />
                </div>
                <h2 class="mt-4 text-base font-semibold">
                  描述你想让 Agent 做什么
                </h2>
                <p class="mt-2 max-w-md text-sm leading-6 text-muted">
                  例如：「finance 报销单导出报 500，请定位并修复」。Agent 会制定计划、修改代码、运行测试，最后交你审查 Diff。
                </p>
                <div class="mt-6 grid w-full max-w-xl gap-2 text-left sm:grid-cols-2">
                  <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      Agent
                    </div>
                    <div class="mt-1 truncate text-sm font-medium">
                      {{ enrollment?.agentId || '-' }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      模板
                    </div>
                    <div class="mt-1 truncate text-sm font-medium">
                      {{ codexTemplate?.id || '-' }}
                    </div>
                  </div>
                </div>
                <UAlert
                  v-if="enrollment && !codexTemplate"
                  class="mt-5 max-w-md text-left"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-circle-alert"
                  title="Agent 未开放默认执行能力"
                  description="请在 Dev Agent 配置中启用默认 Codex 执行模板后重试。"
                />
              </div>

              <UChatMessages
                v-else
                :messages="conversationMessages"
                :status="chatStatus"
                should-auto-scroll
                :spacing-offset="150"
                :user="{ side: 'right', variant: 'soft', icon: 'i-lucide-user' }"
                :assistant="{ side: 'left', variant: 'naked', icon: 'i-lucide-sparkles' }"
                class="px-0"
              >
                <template #content="{ message }">
                  <div
                    v-if="isPromptMessage(message)"
                    class="space-y-3"
                  >
                    <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <UBadge color="neutral" variant="subtle">
                        {{ currentJob?.templateId || codexTemplate?.id || CODEX_APP_SERVER_TEMPLATE_ID }}
                      </UBadge>
                      <span>{{ formatClock(currentJob?.createdAt) }}</span>
                    </div>
                    <p class="whitespace-pre-wrap break-words text-sm leading-6">
                      {{ currentPrompt }}
                    </p>
                    <div
                      v-if="currentJob?.attachments?.length"
                      class="flex flex-wrap gap-2"
                    >
                      <UBadge
                        v-for="attachment in currentJob.attachments"
                        :key="attachment.id"
                        color="neutral"
                        variant="subtle"
                        class="max-w-64 truncate"
                      >
                        <UIcon name="i-lucide-paperclip" class="size-3.5" />
                        {{ attachment.filename }}
                      </UBadge>
                    </div>
                  </div>

                  <div
                    v-else
                    class="space-y-4"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <WebStatusBadge :status="currentJob?.status" />
                      <span class="text-xs text-muted">
                        {{ currentJob?.startedAt ? `开始 ${formatClock(currentJob.startedAt)}` : '等待开始' }}
                      </span>
                      <span class="text-xs text-muted">
                        {{ currentJob?.finishedAt ? `结束 ${formatClock(currentJob.finishedAt)}` : `耗时 ${jobDurationText}` }}
                      </span>
                    </div>

                    <JobEventStream
                      :events="events"
                      :active="isJobActive"
                    />

                    <div
                      v-if="!events.length && isJobActive"
                      class="rounded-md border border-default bg-elevated/40 px-3 py-2 text-sm text-muted"
                    >
                      等待 Dev Agent 返回事件
                    </div>

                    <UAlert
                      v-if="currentJob && terminalStatuses.has(currentJob.status) && currentJob.status === 'succeeded'"
                      color="success"
                      variant="soft"
                      icon="i-lucide-git-pull-request-arrow"
                      class="items-center"
                    >
                      <template #title>
                        <span class="font-medium">变更已就绪 · 测试通过</span>
                      </template>
                      <template #actions>
                        <UButton
                          to="/review"
                          color="success"
                          variant="solid"
                          size="xs"
                          trailing-icon="i-lucide-arrow-right"
                        >
                          查看 Diff 审查
                        </UButton>
                      </template>
                    </UAlert>
                  </div>
                </template>
              </UChatMessages>

              <UAlert
                v-if="currentJob?.error"
                class="mt-4"
                color="error"
                variant="soft"
                icon="i-lucide-circle-alert"
                :title="currentJob.error"
              />
            </div>
          </div>

          <!-- 指令输入 -->
          <div class="border-t border-default bg-default px-4 py-3">
            <div
              class="mx-auto max-w-4xl"
              @dragover.prevent
              @drop.prevent="onDropAttachments"
              @paste="onPasteAttachments"
            >
              <input
                ref="fileInput"
                class="hidden"
                type="file"
                multiple
                @change="onFileInputChange"
              >
              <div
                v-if="selectedFiles.length"
                class="mb-2 flex flex-wrap gap-2"
              >
                <div
                  v-for="(file, index) in selectedFiles"
                  :key="attachmentFileKey(file, index)"
                  class="flex max-w-full items-center gap-1.5 rounded-md border border-default bg-elevated px-2 py-1 text-xs"
                >
                  <UIcon name="i-lucide-file" class="size-3.5 shrink-0 text-muted" />
                  <span class="max-w-52 truncate">{{ file.name }}</span>
                  <span class="shrink-0 text-muted">{{ formatBytes(file.size) }}</span>
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    aria-label="移除附件"
                    @click="removeFile(index)"
                  />
                </div>
              </div>
              <UChatPrompt
                v-model="prompt"
                variant="subtle"
                icon="i-lucide-sparkles"
                :placeholder="isJobActive ? 'Agent 运行中，可发送补充说明…' : '发送指令，引导或纠正 Agent…（⌘↵ 发送）'"
                :rows="2"
                :maxrows="8"
                :disabled="!codexTemplate || loading || uploadingAttachments"
                @submit="createJob"
              >
                <template #footer>
                  <div class="flex w-full items-center gap-3">
                    <UTooltip text="添加文件或图片">
                      <UButton
                        icon="i-lucide-paperclip"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        square
                        :disabled="loading || isJobActive"
                        aria-label="添加文件或图片"
                        @click="openFilePicker"
                      />
                    </UTooltip>
                    <UBadge color="neutral" variant="subtle" class="font-mono">
                      claude.exec
                    </UBadge>
                    <div class="truncate text-xs text-muted">
                      {{ footerHint }}
                    </div>
                    <UChatPromptSubmit
                      class="ml-auto shrink-0"
                      :status="promptStatus"
                      :disabled="!canStopOrSubmit"
                      @stop="cancelJob"
                      @reload="createJob"
                    />
                  </div>
                </template>
              </UChatPrompt>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
