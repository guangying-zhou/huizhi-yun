<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'

const { apiBase } = useApiBase()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'progress', value: string): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})

const toast = useToast()

// =============== 文件入库运行日志（commit_files_ingest）查看 ===============
interface IngestionRunItem {
  id: number
}
interface IngestionRunsResponse {
  data: Array<{ id: number }>
}
interface IngestionLogItem {
  id: number
  runId: number
  level: string
  message: string
  context?: unknown
  createdAt: string
}
interface IngestionLogsResponse {
  data: IngestionLogItem[]
}

const logsLoading = ref(false)
const logsRunId = ref<number | null>(null)
const logEntries = ref<IngestionLogItem[]>([])
const lastLogId = ref<number | null>(null)
const logsContainerRef = ref<HTMLDivElement | null>(null)
const logsTimer = ref<number | null>(null)
const logsErrorsOnly = ref(false)
// 从日志中提取的 processed_total 文本（优先用于展示）
const progressLabelFromLogs = ref<string | null>(null)
// 预计剩余时间文本
const estimatedRemainingLabel = ref<string | null>(null)

// 阶段B（文件入库）运行状态与控制
type StageBStatus = {
  totalCommits: number
  ingestedCommits: number
  remainingCommits: number
  progressPercent: number
  stopRequested: boolean
  latestRun: null | {
    id: number
    status: string
    startedAt: string
    finishedAt: string | null
    itemsProcessed: number | null
    itemsFailed: number | null
    params: Record<string, unknown> | null
  }
}
const stageB = reactive<StageBStatus>({
  totalCommits: 0,
  ingestedCommits: 0,
  remainingCommits: 0,
  progressPercent: 0,
  stopRequested: false,
  latestRun: null
})
const stageBLoading = reactive({ start: false, stop: false })

async function fetchStageBStatus() {
  try {
    const resp = await $fetch<StageBStatus>(`${apiBase}/ingestion/files/progress`)
    stageB.totalCommits = resp.totalCommits
    stageB.ingestedCommits = resp.ingestedCommits
    stageB.remainingCommits = resp.remainingCommits
    stageB.progressPercent = resp.progressPercent
    stageB.stopRequested = !!resp.stopRequested
    stageB.latestRun = resp.latestRun

    // 状态更新后重新计算（因为 remainingCommits 变了）
    if (logEntries.value.length > 0) {
      updateEstimatesFromLogs(logEntries.value)
    }
  } catch {
    // 静默失败，保留旧状态
  }
}

async function startStageBIngest() {
  if (stageBLoading.start) return
  try {
    stageBLoading.start = true
    const res = await $fetch<{ started: boolean, runId?: number | null }>(
      `${apiBase}/ingestion/files/start`,
      {
        method: 'POST',
        body: { batchSize: 50, includeInvalid: false, triggeredBy: 'ui', noDiffs: true }
      }
    )
    if (res?.started) {
      toast.add({ title: '文件入库已启动', color: 'success' })
      await fetchStageBStatus()
    } else {
      toast.add({
        title: '文件入库已在运行',
        description: `Run ID: ${res?.runId ?? '-'}`,
        color: 'warning'
      })
    }
  } catch (error) {
    toast.add({
      title: '启动失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    stageBLoading.start = false
  }
}

async function requestStopStageB() {
  if (stageBLoading.stop) return
  try {
    stageBLoading.stop = true
    await $fetch(`${apiBase}/ingestion/files/stop`, { method: 'POST' })
    toast.add({
      title: '已请求停止',
      description: '将于当前批次结束后停止',
      color: 'warning'
    })
    await fetchStageBStatus()
  } catch (error) {
    toast.add({
      title: '停止请求失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    stageBLoading.stop = false
  }
}
const filteredLogEntries = computed(() => {
  if (!logsErrorsOnly.value) return logEntries.value
  return logEntries.value.filter(
    it => (it.level || '').toLowerCase() === 'error'
  )
})

async function loadLatestIngestLogs(initial = false) {
  try {
    logsLoading.value = true
    // 1) 查询 job_type=commit_files_ingest 的最近一条 run（按 startedAt DESC）
    const runsResp = await $fetch<IngestionRunsResponse>(
      `${apiBase}/ingestion/runs`,
      {
        params: { jobType: 'commit_files_ingest', page: 1, pageSize: 1 }
      }
    )
    const latest: IngestionRunItem | undefined = runsResp?.data?.[0]
    if (!latest) {
      // toast.add({
      //   title: '暂无运行记录',
      //   description: '未找到 commit_files_ingest 的运行记录。',
      //   color: 'warning'
      // })
      return
    }
    const runChanged = logsRunId.value !== latest.id
    logsRunId.value = latest.id

    // 2) 入库该 run 的日志
    //   - 只看 ERROR 或初次/切换 run：按时间降序取最新 10 条，然后前端反转为升序显示
    //   - 增量模式（非只看 ERROR）：按时间降序取最近 100 条，再前端反转后基于 lastLogId 追加
    const useErrorsOnly = logsErrorsOnly.value === true
    const lim = initial || runChanged || useErrorsOnly ? 10 : 100
    const logsResp = await $fetch<IngestionLogsResponse>(
      `${apiBase}/ingestion/runs/${latest.id}/logs`,
      {
        params: useErrorsOnly
          ? { limit: lim, order: 'desc', level: 'error' }
          : { limit: lim, order: 'desc' }
      }
    )
    const rowsDesc = logsResp?.data || []
    const rows = rowsDesc.slice().reverse() // 转为升序，便于与现有 UI/追加逻辑对齐

    const rowsToUse = useErrorsOnly
      ? rows.filter(r => (r.level || '').toLowerCase() === 'error')
      : rows

    if (initial || runChanged || useErrorsOnly) {
      // 初次/切换 run/只看 ERROR 模式：直接重置为最后 10 条
      const lastTen = rowsToUse.slice(-10)
      logEntries.value = lastTen
      lastLogId.value = lastTen.length
        ? lastTen[lastTen.length - 1]?.id ?? null
        : null
    } else {
      // 增量：仅在“非只看 ERROR”时做增量（维持原先追加逻辑）
      const newOnes
        = lastLogId.value != null
          ? rowsToUse.filter(r => r.id > (lastLogId.value as number))
          : rowsToUse
      if (newOnes.length) {
        logEntries.value = [...logEntries.value, ...newOnes]
        lastLogId.value = newOnes[newOnes.length - 1]?.id ?? lastLogId.value
        // 控制列表长度，最多保留 100 条，清理更早的
        if (logEntries.value.length > 100) {
          logEntries.value = logEntries.value.slice(-100)
        }
      }
    }

    await nextTick()
    const c = logsContainerRef.value
    if (c) {
      c.scrollTop = c.scrollHeight
    }
    // 更新进度和预估时间
    updateEstimatesFromLogs(logEntries.value)

    if (progressLabelFromLogs.value) {
      // emit('progress', progressLabelFromLogs.value)
    }
    // 合并：刷新日志后立即刷新状态
    await fetchStageBStatus()
  } catch (error) {
    toast.add({
      title: '获取运行日志失败',
      description: extractErrorMessage(error),
      color: 'error'
    })
  } finally {
    logsLoading.value = false
  }
}

// 从日志中解析进度文本和计算预计剩余时间
function updateEstimatesFromLogs(entries: IngestionLogItem[]) {
  progressLabelFromLogs.value = null
  estimatedRemainingLabel.value = null

  for (let i = entries.length - 1; i >= 0; i--) {
    const it = entries[i]
    if (!it) continue
    if ((it.message || '').toLowerCase() !== 'progress') continue
    const ctx = it.context as unknown
    if (ctx == null) continue

    // 尝试提取 progressLabelFromLogs
    if (typeof ctx === 'string') {
      progressLabelFromLogs.value = ctx.trim()
      // 字符串格式无法提取 elapsed_seconds，跳过剩余时间计算
      return
    }

    try {
      const obj = ctx as Record<string, unknown>
      // 1. 进度文本
      const raw = (obj.processed_total ?? obj.processedTotal) as unknown
      if (raw != null) {
        progressLabelFromLogs.value = String(raw)
      }

      // 2. 预计剩余时间计算
      // 需要字段: processed_this_run (当前运行处理数), elapsed_seconds (当前运行耗时)
      // 外部状态: stageB.remainingCommits (剩余总数)
      const processedThisRun = Number(obj.processed_this_run ?? obj.processedThisRun)
      const elapsedSeconds = Number(obj.elapsed_seconds ?? obj.elapsedSeconds)
      const remaining = stageB.remainingCommits

      if (!isNaN(processedThisRun) && !isNaN(elapsedSeconds) && elapsedSeconds > 0 && processedThisRun > 0 && remaining > 0) {
        const speed = processedThisRun / elapsedSeconds // items per second
        const remainingSeconds = remaining / speed
        estimatedRemainingLabel.value = formatDuration(remainingSeconds)
      }
    } catch {
      // ignore
      continue
    }

    // 只要找到一条最近的 progress 记录就停止
    return
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}秒`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}小时${mins}分钟`
}

// 切换“只看 ERROR”时，立即重新入库并展示最近 10 条错误日志/全部日志
watch(logsErrorsOnly, () => {
  if (isOpen.value) {
    loadLatestIngestLogs(true)
  }
})

watch(isOpen, (open, prev) => {
  if (open) {
    // 打开后开始 30 秒轮询增量更新
    if (logsTimer.value) {
      clearInterval(logsTimer.value)
      logsTimer.value = null
    }
    // 立即加载一次
    loadLatestIngestLogs(true)

    logsTimer.value = window.setInterval(() => {
      // 若未关闭模态，尝试增量加载
      if (isOpen.value) {
        loadLatestIngestLogs(false)
      }
    }, 30000)
    // 初次打开时也同步刷新一次状态
    fetchStageBStatus()
  } else if (!open && prev) {
    // 关闭时清理定时器
    if (logsTimer.value) {
      clearInterval(logsTimer.value)
      logsTimer.value = null
    }
    // 关闭时回传当前进度信息给父组件
    let progressText = progressLabelFromLogs.value
    if (!progressText && stageB.totalCommits > 0) {
      progressText = `${stageB.ingestedCommits} / ${stageB.totalCommits}（${stageB.progressPercent}%）`
    }
    if (progressText) {
      emit('progress', progressText)
    }
  }
})

onBeforeUnmount(() => {
  if (logsTimer.value) {
    clearInterval(logsTimer.value)
    logsTimer.value = null
  }
})

defineExpose({
  open: () => { isOpen.value = true }
})
</script>

<template>
  <!-- 文件入库运行日志（commit_files_ingest）对话框 -->
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'sm:max-w-4xl', footer: 'justify-end' }"
    title="版本数据入库"
    description="按时间先后顺序将未入库的仓库版本数据转入数据库，然后进行数据去重处理。关闭窗口不影响后台处理。"
  >
    <template #body>
      <div class="space-y-3">
        <!-- 顶部状态与控制区域 -->
        <div class="space-y-2 rounded border border-gray-200 p-3 text-xs dark:border-gray-800">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-muted-500">待处理：</span>
              <span class="font-mono pr-2">{{
                stageB.remainingCommits ?? "-"
              }}</span>
              <span
                v-if="estimatedRemainingLabel"
                class="text-muted-400 text-[11px]"
              >
                (预计还需 {{ estimatedRemainingLabel }})
              </span>
              <!-- <USwitch v-model="logsErrorsOnly" unchecked-icon="i-lucide-x" checked-icon="i-lucide-check" size="xs"
                label="仅ERROR" /> -->
            </div>
            <div class="flex items-center gap-2">
              <UBadge
                :label="stageB.latestRun && stageB.latestRun.status
                  ? stageB.latestRun.status.toUpperCase()
                  : 'N/A'
                "
                :color="stageB.latestRun?.status === 'running'
                  ? 'warning'
                  : stageB.latestRun?.status === 'success'
                    ? 'success'
                    : stageB.latestRun?.status === 'failed'
                      ? 'error'
                      : 'neutral'
                "
                variant="soft"
              />
              <span>
                进度：
                <template v-if="progressLabelFromLogs">
                  {{ progressLabelFromLogs.split('(')[0] }}
                </template>
                <template v-else>
                  {{ stageB.progressPercent }}%
                </template>
              </span>
              <span
                v-if="stageB.stopRequested"
                class="ml-2 text-error-600"
              >已请求停止</span>
            </div>
          </div>
        </div>
        <div
          ref="logsContainerRef"
          class="h-72 overflow-y-auto rounded border border-gray-200 bg-neutral-50 p-2 font-mono text-[12px] leading-5 dark:border-gray-800 dark:bg-neutral-900"
        >
          <div
            v-if="logsLoading && logEntries.length === 0"
            class="py-10 text-center text-muted-500"
          >
            正在加载...
          </div>
          <div
            v-else-if="!logsLoading && (!logEntries || logEntries.length === 0)"
            class="py-10 text-center text-muted-500"
          >
            暂无日志
          </div>
          <div
            v-else
            class="space-y-1"
          >
            <div
              v-for="item in filteredLogEntries"
              :key="item.id"
              class="px-1"
            >
              <span class="text-muted-500">{{
                formatDate(item.createdAt)
              }}</span>
              <span class="mx-1 text-muted-400">·</span>
              <UBadge
                :label="item.level.toUpperCase()"
                :color="item.level === 'ERROR'
                  ? 'error'
                  : item.level === 'WARNING'
                    ? 'warning'
                    : 'neutral'
                "
                variant="subtle"
                class="align-middle"
              />
              <span class="mx-1 text-muted-400">—</span>
              <span
                :class="item.level && item.level.toLowerCase() === 'error'
                  ? 'text-error-600 dark:text-error-400'
                  : 'text-neutral-800 dark:text-neutral-200'
                "
              >
                {{ item.message }}
              </span>
              <div
                v-if="item.context"
                class="mt-1 overflow-x-auto whitespace-nowrap rounded bg-neutral-100 p-2 font-mono text-[11px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
              >
                {{ formatLogContext(item.context) }}
              </div>
            </div>
          </div>
        </div>
        <div class="text-xs text-muted-500">
          窗口不关闭时每 30 秒自动<UButton
            size="xs"
            variant="soft"
            color="secondary"
            icon="i-lucide-refresh-cw"
            :loading="logsLoading"
            @click="() => loadLatestIngestLogs(false)"
          >
            刷新日志
          </UButton>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="subtle"
          @click="isOpen = false"
        >
          关闭窗口
        </UButton>
        <UButton
          v-if="!stageBLoading.start && stageB.latestRun?.status !== 'running'"
          size="xs"
          color="primary"
          icon="i-lucide-play"
          :loading="stageBLoading.start"
          :disabled="stageBLoading.start || stageB.latestRun?.status === 'running'
          "
          @click="startStageBIngest"
        >
          启动入库
        </UButton>
        <UButton
          v-else-if="stageBLoading.start || stageB.latestRun?.status === 'running'"
          size="xs"
          color="primary"
          icon="i-lucide-square"
          :loading="stageBLoading.start"
          :disabled="stageBLoading.start || stageB.stopRequested"
          @click="requestStopStageB"
        >
          请求停止
        </UButton>
      </div>
    </template>
  </UModal>
</template>
