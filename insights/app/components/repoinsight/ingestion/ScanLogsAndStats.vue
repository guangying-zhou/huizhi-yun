<script setup lang="ts">
import { nextTick, ref, watch, computed } from 'vue'
import type { IngestionRunLog } from '~/types/repoinsight'
import { formatDate, sanitizeLogText } from '~/utils/log'

interface ScanResult {
  processed: number
  succeeded: number
  failed: number
  runId?: number
  updatedRepoIds?: number[]
}

type RunStatus = 'idle' | 'running' | 'success' | 'failed'

const props = defineProps<{
  title: string
  logs: IngestionRunLog[]
  logsLoading: boolean
  result: ScanResult | null
  updatedCount: number
  sourceType: string
  runStatus?: RunStatus
}>()

const logContainerRef = ref<HTMLDivElement | null>(null)

// 自动滚动到底部
watch(
  () => props.logs.length,
  async () => {
    await nextTick()
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  }
)

const statusLabel = computed(() => {
  switch (props.runStatus) {
    case 'running': return '运行中'
    case 'success': return '已完成'
    case 'failed': return '失败'
    default: return '就绪'
  }
})

const statusColor = computed(() => {
  switch (props.runStatus) {
    case 'running': return 'warning'
    case 'success': return 'success'
    case 'failed': return 'error'
    default: return 'neutral'
  }
})

const logLevelClass = (level: string) => {
  const normalized = level.toUpperCase()
  if (normalized === 'ERROR') return 'text-error-600 dark:text-error-400'
  if (normalized === 'WARNING' || normalized === 'WARN') return 'text-warning-600 dark:text-warning-400'
  if (normalized === 'DEBUG') return 'text-neutral-400'
  return 'text-neutral-600 dark:text-neutral-300'
}
</script>

<template>
  <div class="space-y-3 text-sm">
    <!-- 日志区域 -->
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <!-- 标题栏 -->
      <div
        class="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
      >
        <div class="flex items-center gap-2">
          <UIcon
            :name="sourceType === 'SVN' ? 'i-lucide-folder-git-2' : 'i-lucide-gitlab'"
            class="h-4 w-4 text-muted-500"
          />
          <span class="font-medium text-muted-700">{{ title }} 扫描日志</span>
        </div>
        <div class="flex items-center gap-2">
          <UIcon
            v-if="runStatus === 'running'"
            name="i-lucide-loader-circle"
            class="h-4 w-4 animate-spin text-warning-500"
          />
          <UBadge
            :label="statusLabel"
            :color="statusColor"
            variant="subtle"
            size="sm"
          />
        </div>
      </div>

      <!-- 日志内容 -->
      <div
        ref="logContainerRef"
        class="h-40 overflow-y-auto overflow-x-auto bg-neutral-50 p-3 font-mono text-xs dark:bg-neutral-900"
      >
        <div
          v-if="logsLoading && logs.length === 0"
          class="flex items-center gap-2 text-muted-500"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="h-4 w-4 animate-spin"
          />
          <span>加载日志中...</span>
        </div>
        <div
          v-else-if="logs.length > 0"
          class="space-y-1"
        >
          <div
            v-for="log in logs"
            :key="log.id"
            class="whitespace-nowrap py-0.5 border-l-2 pl-2"
            :class="{
              'border-error-400': log.level.toUpperCase() === 'ERROR',
              'border-warning-400': log.level.toUpperCase() === 'WARNING' || log.level.toUpperCase() === 'WARN',
              'border-transparent': !['ERROR', 'WARNING', 'WARN'].includes(log.level.toUpperCase())
            }"
          >
            <span class="text-neutral-400">{{ formatDate(log.createdAt) }}</span>
            <span
              class="mx-1.5 font-medium"
              :class="logLevelClass(log.level)"
            >{{ log.level }}</span>
            <span class="text-neutral-700 dark:text-neutral-200">{{ sanitizeLogText(log.message) }}</span>
            <span
              v-if="log.context"
              class="ml-2 text-[10px] text-neutral-400"
            >
              {{ sanitizeLogText(log.context) }}
            </span>
          </div>
        </div>
        <div
          v-else
          class="text-muted-400 italic flex items-center gap-2"
        >
          <UIcon
            name="i-lucide-scroll-text"
            class="h-4 w-4"
          />
          <span>暂无日志</span>
        </div>
      </div>
    </div>

    <!-- 统计结果区域 -->
    <div
      v-if="result"
      class="grid gap-2 grid-cols-4"
    >
      <div class="rounded-lg border border-gray-200 p-2.5 text-center dark:border-gray-700 bg-white dark:bg-gray-800">
        <div class="text-[10px] text-muted-500 uppercase tracking-wide">
          处理
        </div>
        <div class="text-lg font-bold text-muted-700">
          {{ result.processed }}
        </div>
      </div>
      <div class="rounded-lg border border-gray-200 p-2.5 text-center dark:border-gray-700 bg-white dark:bg-gray-800">
        <div class="text-[10px] text-muted-500 uppercase tracking-wide">
          成功
        </div>
        <div class="text-lg font-bold text-success-600">
          {{ result.succeeded }}
        </div>
      </div>
      <div class="rounded-lg border border-gray-200 p-2.5 text-center dark:border-gray-700 bg-white dark:bg-gray-800">
        <div class="text-[10px] text-muted-500 uppercase tracking-wide">
          失败
        </div>
        <div
          class="text-lg font-bold"
          :class="result.failed ? 'text-error-600' : 'text-muted-400'"
        >
          {{ result.failed }}
        </div>
      </div>
      <div class="rounded-lg border border-gray-200 p-2.5 text-center dark:border-gray-700 bg-white dark:bg-gray-800">
        <div class="text-[10px] text-muted-500 uppercase tracking-wide">
          更新
        </div>
        <div class="text-lg font-bold text-primary-600">
          {{ updatedCount }}
        </div>
      </div>
    </div>
  </div>
</template>
